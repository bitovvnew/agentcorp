// Tiny zero-dependency HTTP server: serves the dashboard, streams frames over SSE, accepts controls.
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHOCKS, type ShockKind, type Simulation } from './engine.js';
import type { Replay } from './types.js';

export const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

export interface ServeOptions {
  port: number;
  host?: string;
  /** Live mode: the simulation to run. */
  sim?: Simulation;
  /** Replay mode: a finished run to show. */
  replay?: Replay;
  /** Weeks per second in live mode. 0 = as fast as possible. */
  speed?: number;
  /** Start paused (useful for screenshots). */
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
  const { sim } = opts;
  const clients = new Set<http.ServerResponse>();
  let speed = opts.speed ?? 2;
  let paused = !!opts.paused;
  let resolveDone!: (r: Replay | undefined) => void;
  const done = new Promise<Replay | undefined>((r) => (resolveDone = r));

  const send = (res: http.ServerResponse, event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const broadcast = (event: string, data: unknown) => {
    for (const c of clients) send(c, event, data);
  };
  const status = () => ({ mode: sim ? 'live' : 'replay', paused, speed, week: sim?.week ?? 0, finished: sim ? sim.finished : true });

  if (sim) {
    sim.onFrame((frame, events) => {
      broadcast('tick', { frame, events });
      if (sim.finished) broadcast('done', { league: sim.league() });
    });
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const p = url.pathname;
      if (p === '/api/replay') return json(res, sim ? sim.toReplay() : opts.replay);
      if (p === '/api/status') return json(res, status());
      if (p === '/api/shocks') return json(res, SHOCKS);
      if (p === '/api/download') {
        const r = sim ? sim.toReplay() : opts.replay;
        res.writeHead(200, {
          'content-type': 'application/json',
          'content-disposition': `attachment; filename="agentcorp-replay-${r?.config.seed ?? 'run'}.json"`,
        });
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
      return serveStatic(res, p);
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : String(err) }, 400);
    }
  });

  const port = await listen(server, opts.port, opts.host ?? '127.0.0.1');
  const url = `http://localhost:${port}`;

  // Live loop
  let stopped = false;
  if (sim) {
    (async () => {
      while (!stopped && !sim.finished) {
        if (paused) { await sleep(120); continue; }
        await sim.step();
        if (speed > 0) await sleep(1000 / speed);
        else await sleep(0);
      }
      if (!stopped) {
        const r = sim.toReplay();
        opts.onFinish?.(r);
        resolveDone(r);
      }
    })().catch((err) => {
      broadcast('error', { message: err instanceof Error ? err.message : String(err) });
      if (!opts.quiet) console.error(err);
      resolveDone(undefined);
    });
  } else {
    resolveDone(opts.replay);
  }

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

function serveStatic(res: http.ServerResponse, p: string) {
  const rel = p === '/' ? 'index.html' : decodeURIComponent(p).replace(/^\/+/, '');
  const file = path.resolve(WEB_DIR, rel);
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

function json(res: http.ServerResponse, data: unknown, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-cache' });
  res.end(JSON.stringify(data ?? null));
}

function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e5) reject(new Error('body too large'));
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

/** Build a single self-contained HTML file with the replay embedded — easy to share anywhere. */
export function exportHtml(replay: Replay): string {
  const html = fs.readFileSync(path.join(WEB_DIR, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(WEB_DIR, 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(WEB_DIR, 'app.js'), 'utf8');
  const data = JSON.stringify(replay).replace(/</g, '\\u003c');
  return html
    .replace('<link rel="stylesheet" href="styles.css">', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="app.js"></script>', () => `<script>window.__AGENTCORP_REPLAY__ = ${data};</script>\n<script type="module">\n${js}\n</script>`);
}
