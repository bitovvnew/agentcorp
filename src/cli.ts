// agentcorp — command line entry point.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createSimulation, DEMO_LEAGUE } from './index.js';
import { VERSION, type Simulation } from './engine.js';
import { fmtTokens, SEGMENTS } from './economy.js';
import { createBrain, listBrains } from './brains/index.js';
import { listScenarios, listTemplates, loadPluginFile } from './plugins/index.js';
import { readReplay, writeReplay } from './replay.js';
import { exportHtml, serve } from './server.js';
import type { LeagueRow, SimConfig } from './types.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  bold: (s: string) => (tty ? `\x1b[1m${s}\x1b[22m` : s),
  dim: (s: string) => (tty ? `\x1b[2m${s}\x1b[22m` : s),
  green: (s: string) => (tty ? `\x1b[32m${s}\x1b[39m` : s),
  red: (s: string) => (tty ? `\x1b[31m${s}\x1b[39m` : s),
  yellow: (s: string) => (tty ? `\x1b[33m${s}\x1b[39m` : s),
  cyan: (s: string) => (tty ? `\x1b[36m${s}\x1b[39m` : s),
  magenta: (s: string) => (tty ? `\x1b[35m${s}\x1b[39m` : s),
};

const HELP = `
${c.bold('AgentCorp')} ${c.dim(`v${VERSION}`)} — AI startup simulator. Which LLM runs the best company?

${c.bold('Usage')}
  agentcorp [demo]                       Keyless demo league, live in your browser
  agentcorp league --brains <a,b,c,…>    Companies with different CEO brains compete in one market
  agentcorp run --brain <spec>           A single company
  agentcorp replay <file.json>           Open a saved replay in the dashboard
  agentcorp export <file.json> [--out f] Turn a replay into one shareable HTML file
  agentcorp list                         Templates, scenarios and brains

${c.bold('Options')}
  --template <id>       Company template for every company (default: saas)
  --templates <a,b,…>   One template per company
  --names <a,b,…>       Company names
  --scenario <id>       Market scenario (default: baseline)
  --weeks <n>           Season length in weeks (default: 104)
  --seed <n>            Random seed — same seed, same world (default: 42)
  --decide-every <n>    LLM CEOs decide every n weeks (default: 4)
  --token-charge <x>    Charge companies x ◈ per real LLM token their CEO spends (default: 0)
  --plugin <file.js>    Load a template or scenario plugin (repeatable)
  --headless            Run in the terminal, no dashboard
  --out <file>          Save the replay (JSON) or export (HTML) here
  --speed <n>           Weeks per second in the live dashboard (default: 2, 0 = max)
  --port <n>            Dashboard port (default: 4747)
  --paused              Start the dashboard paused
  --no-open             Do not open a browser

${c.bold('Brains')}
  balanced | blitzscaler | bootstrapper | visionary      built-in CEOs, no API key
  anthropic[:model]  openai:<model>  gemini:<model>  ollama[:model]  openai-compatible:<model>

${c.bold('Examples')}
  npx agentcorp
  agentcorp league --brains anthropic,openai:<model>,gemini:<model>,ollama:llama3.2
  agentcorp league --brains blitzscaler,bootstrapper --scenario ai-winter --headless --out run.json
  agentcorp run --brain visionary --template devtools --weeks 52
`;

interface Args {
  _: string[];
  [k: string]: string | boolean | string[] | undefined;
}

export function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] };
  const plugins: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=', 2);
      if (k.startsWith('no-')) { out[k.slice(3)] = false; continue; }
      const next = argv[i + 1];
      const value = inline ?? (next !== undefined && !next.startsWith('--') ? (i++, next) : true);
      if (k === 'plugin') plugins.push(String(value));
      else out[k] = value;
    } else if (a === '-h') out.help = true;
    else if (a === '-v') out.version = true;
    else out._.push(a);
  }
  out.plugin = plugins;
  return out;
}

function str(a: Args, k: string, d?: string): string | undefined {
  const v = a[k];
  return typeof v === 'string' ? v : d;
}
function num(a: Args, k: string, d: number): number {
  const v = a[k];
  if (typeof v !== 'string') return d;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`--${k} must be a number`);
  return n;
}
function list(a: Args, k: string): string[] | undefined {
  const v = str(a, k);
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseArgs(argv);
  if (args.version) { console.log(VERSION); return 0; }
  if (args.help) { console.log(HELP); return 0; }
  for (const p of args.plugin as string[]) await loadPluginFile(p);
  const cmd = args._[0] ?? 'demo';

  switch (cmd) {
    case 'help': console.log(HELP); return 0;
    case 'list': printList(); return 0;
    case 'replay': return replayCmd(args);
    case 'export': return exportCmd(args);
    case 'demo':
    case 'league':
    case 'run': return runCmd(cmd, args);
    default:
      console.error(c.red(`Unknown command "${cmd}".`) + ' Try agentcorp --help');
      return 1;
  }
}

function buildConfig(cmd: string, args: Args): SimConfig {
  const base = DEMO_LEAGUE;
  let brains: string[];
  if (cmd === 'run') brains = [str(args, 'brain', 'balanced')!];
  else brains = list(args, 'brains') ?? list(args, 'brain') ?? base.companies.map((x) => x.brain);
  const templates = list(args, 'templates');
  const template = str(args, 'template');
  const names = list(args, 'names') ?? [];
  if (templates && templates.length !== brains.length) throw new Error(`--templates needs ${brains.length} entries (one per brain)`);
  return {
    title: cmd === 'run' ? 'Single company' : cmd === 'demo' ? 'Demo league' : 'League',
    seed: Math.floor(num(args, 'seed', base.seed)),
    weeks: Math.floor(num(args, 'weeks', base.weeks)),
    scenario: str(args, 'scenario', base.scenario)!,
    decideEvery: Math.floor(num(args, 'decide-every', 4)),
    tokenCharge: num(args, 'token-charge', 0),
    companies: brains.map((brain, i) => ({ brain, template: templates?.[i] ?? template ?? 'saas', name: names[i] })),
  };
}

async function runCmd(cmd: string, args: Args): Promise<number> {
  const config = buildConfig(cmd, args);
  // Fail fast on bad brain specs / missing keys before anything starts.
  const brains = config.companies.map((x) => createBrain(x.brain, { decideEvery: config.decideEvery }));
  const sim = createSimulation(config, brains);
  const out = str(args, 'out');
  const llm = brains.filter((b) => b.kind === 'llm');
  if (llm.length) console.log(c.dim(`LLM CEOs: ${llm.map((b) => b.label).join(', ')} — deciding every ${config.decideEvery} weeks.`));

  if (args.headless) {
    console.log(`${c.bold('AgentCorp')} ${c.dim(`v${VERSION}`)} · ${config.title} · scenario ${c.cyan(sim.scenario.name)} · seed ${config.seed} · ${config.weeks} weeks\n`);
    sim.onFrame((_f, events) => {
      for (const e of events) if (e.importance === 3) {
        const who = e.companyId ? sim.companies.find((x) => x.id === e.companyId)?.name : undefined;
        console.log(`${c.dim(`W${String(e.week).padStart(3)}`)} ${who ? c.bold(who) + ' ' : ''}${e.text}`);
      }
    });
    const replay = await sim.runToEnd();
    printLeague(sim.league(), sim);
    if (out) { writeReplay(out, replay); console.log(c.dim(`\nReplay saved to ${out} — open it with: agentcorp replay ${out}`)); }
    return 0;
  }

  const server = await serve({
    sim,
    port: Math.floor(num(args, 'port', 4747)),
    speed: num(args, 'speed', 2),
    paused: !!args.paused,
    onFinish: (r) => {
      if (out) writeReplay(out, r);
    },
  });
  console.log(`\n  ${c.bold('AgentCorp')} ${c.dim(`v${VERSION}`)} — ${config.title}, ${sim.scenario.name}\n`);
  console.log(`  Dashboard  ${c.cyan(server.url)}`);
  console.log(c.dim('  Ctrl+C to stop.\n'));
  if (args.open !== false && !process.env.CI) openBrowser(server.url);
  const replay = await server.done;
  if (replay?.league) printLeague(replay.league, sim);
  if (out) console.log(c.dim(`Replay saved to ${out}`));
  console.log(c.dim('\nSeason over. The dashboard stays up for replays — Ctrl+C to exit.'));
  await new Promise(() => {});
  return 0;
}

async function replayCmd(args: Args): Promise<number> {
  const file = args._[1];
  if (!file) throw new Error('Usage: agentcorp replay <file.json>');
  const replay = readReplay(file);
  const server = await serve({ replay, port: Math.floor(num(args, 'port', 4747)) });
  console.log(`\n  ${c.bold('AgentCorp replay')} — ${path.basename(file)} (${replay.frames.length - 1} weeks)\n  Dashboard  ${c.cyan(server.url)}\n`);
  if (args.open !== false && !process.env.CI) openBrowser(server.url);
  await new Promise(() => {});
  return 0;
}

function exportCmd(args: Args): number {
  const file = args._[1];
  if (!file) throw new Error('Usage: agentcorp export <replay.json> [--out file.html]');
  const replay = readReplay(file);
  const out = str(args, 'out') ?? file.replace(/\.json$/i, '') + '.html';
  fs.writeFileSync(out, exportHtml(replay));
  console.log(`Wrote ${out} (${(fs.statSync(out).size / 1024).toFixed(0)} KB). Open it in any browser — no server needed.`);
  return 0;
}

function printList() {
  console.log(c.bold('\nTemplates'));
  for (const t of listTemplates()) console.log(`  ${c.cyan(t.id.padEnd(12))} ${t.name.padEnd(20)} ${c.dim(`${SEGMENTS[t.segment].label}, ${fmtTokens(t.cash)}, ${t.team.length} people — ${t.description}`)}`);
  console.log(c.bold('\nScenarios'));
  for (const s of listScenarios()) console.log(`  ${c.cyan(s.id.padEnd(12))} ${s.name.padEnd(20)} ${c.dim(s.description)}`);
  console.log(c.bold('\nBrains'));
  for (const b of listBrains()) console.log(`  ${c.cyan(b.spec.padEnd(26))} ${c.dim(b.description)}`);
  console.log('');
}

export function printLeague(rows: LeagueRow[], sim?: Simulation) {
  const head = ['#', 'Company', 'CEO brain', 'Status', 'Valuation', 'ARR', 'Customers', 'Team', 'Founders'];
  const data = rows.map((r) => [
    String(r.rank),
    r.name,
    r.brainLabel,
    r.status === 'unicorn' ? '🦄 unicorn' : r.status === 'bankrupt' ? '💀 dead' : 'alive',
    r.status === 'bankrupt' ? '—' : fmtTokens(r.valuation),
    fmtTokens(r.arr),
    r.customers.toLocaleString('en-US'),
    String(r.headcount),
    `${Math.round(r.founderStake * 100)}%`,
  ]);
  const widths = head.map((h, i) => Math.max(visible(h), ...data.map((d) => visible(d[i]))));
  const line = (cells: string[]) => cells.map((x, i) => x + ' '.repeat(widths[i] - visible(x))).join('  ');
  console.log('\n' + c.bold(`🏆 League table${sim ? ` — week ${sim.week}` : ''}`));
  console.log(c.dim(line(head)));
  data.forEach((d, i) => {
    const row = line(d);
    console.log(i === 0 ? c.green(row) : rows[i].status === 'bankrupt' ? c.dim(row) : row);
  });
}

function visible(s: string): number {
  // Emoji count as two columns in most terminals.
  return [...s].reduce((n, ch) => n + ((ch.codePointAt(0) ?? 0) > 0x2000 ? 2 : 1), 0);
}

function openBrowser(url: string) {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '""', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    /* no browser available — the URL is printed anyway */
  }
}
