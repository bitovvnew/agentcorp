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
import type { LeagueRow, Replay, SimConfig } from './types.js';
import { pathToFileURL } from 'node:url';
import { WEB_DIR } from './server.js';
import { applyConfig, loadConfig, loadDotEnv, type LeagueSetup } from './config.js';
import { PROVIDERS, probe, type ProviderId } from './providers.js';
import { runWizard } from './wizard.js';
import { runSeason } from './season.js';
import { seasonHtml } from './season-html.js';
import { detectLang, LANGS } from './i18n.js';

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
  agentcorp                              Open first-run setup, or run your saved league
  agentcorp setup [--web]                Pick providers, paste keys (checked live), pick models, save locally
  agentcorp models <provider>            List the models a provider offers you (openai, anthropic, gemini, openrouter, groq, ollama)
  agentcorp league --brains <a,b,c,…>    Companies with different CEO brains compete in one market
  agentcorp season --brains <a,b,…>      Several races across seeds and scenarios; points decide the champion
  agentcorp demo                         No keys: the four built-in strategy CEOs (alias: offline)
  agentcorp run --brain <spec>           A single company
  agentcorp replay <file.json>           Open a saved replay in the dashboard
  agentcorp export <file.json> [--out f] Turn a replay into one shareable HTML file
  agentcorp pitch <file.json> [--company id] [--week n]   Investor pitch deck (Markdown) from a run
  agentcorp list                         Templates, scenarios and brains

${c.bold('Options')}
  --template <id> | --templates <a,b,…>   Company template(s) (default: saas)
  --names <a,b,…>       Company names
  --scenario <id>       Market scenario (default: baseline). Season: --scenarios a,b
  --weeks <n>           Season length in weeks (default: 104)
  --seed <n>            Random seed: same seed, same world (default: 42). Season: --runs n
  --decide-every <n>    LLM CEOs decide every n weeks (default: 4)
  --max-tokens-agent <n>  Spend cap per LLM CEO in tokens (default: 400000), then autopilot
  --max-tokens-total <n>  Spend cap for the whole league (default: 2000000)
  --token-charge <x>    Charge companies x ◈ per real LLM token their CEO spends (default: 0)
  --plugin <file.js>    Load a template or scenario plugin (repeatable)
  --lang <code>         ${LANGS.join(', ')} (default: auto)
  --headless            Run in the terminal, no dashboard
  --out <file>          Save the replay (JSON), export (HTML) or pitch (MD) here
  --speed <n>           Weeks per second in the live dashboard (default: 2, 0 = max)
  --port <n>            Dashboard port (default: 4747)
  --paused | --no-open

${c.bold('Brains')}
  openai:<model>  anthropic:<model>  gemini:<model>  openrouter:<model>  groq:<model>  ollama:<model>  openai-compatible:<model>
  Free: ollama (local), groq and gemini free tiers, openrouter models ending in :free  (agentcorp setup --free)
  balanced | blitzscaler | bootstrapper | visionary      offline strategy CEOs, no key, not LLMs

${c.bold('Examples')}
  npx github:bitovvnew/agentcorp
  agentcorp models openai
  agentcorp league --brains anthropic:<model>,openai:<model>,ollama:<model> --scenario ai-winter
  agentcorp season --brains blitzscaler,bootstrapper,visionary --runs 5 --scenarios baseline,recession --headless
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
  loadDotEnv();
  const cfg = loadConfig();
  applyConfig(cfg);
  for (const p of args.plugin as string[]) await loadPluginFile(p);
  const cmd = args._[0] ?? 'start';

  switch (cmd) {
    case 'help': console.log(HELP); return 0;
    case 'list': printList(); return 0;
    case 'setup': return setupCmd(args);
    case 'models': return modelsCmd(args);
    case 'replay': return replayCmd(args);
    case 'export': return exportCmd(args);
    case 'pitch': return pitchCmd(args);
    case 'season': return seasonCmd(args);
    case 'start': return startCmd(args);
    case 'demo':
    case 'offline':
    case 'league':
    case 'run': return runCmd(cmd === 'demo' ? 'offline' : cmd, args);
    default:
      console.error(c.red(`Unknown command "${cmd}".`) + ' Try agentcorp --help');
      return 1;
  }
}

function budgetOf(args: Args): SimConfig['budget'] {
  return { perAgentTokens: Math.floor(num(args, 'max-tokens-agent', 400_000)), totalTokens: Math.floor(num(args, 'max-tokens-total', 2_000_000)) };
}

function buildConfig(cmd: string, args: Args): SimConfig {
  const base = DEMO_LEAGUE;
  let brains: string[];
  if (cmd === 'run') brains = [str(args, 'brain', 'balanced')!];
  else if (cmd === 'offline') brains = base.companies.map((x) => x.brain);
  else {
    const given = list(args, 'brains') ?? list(args, 'brain');
    if (!given) throw new Error('Name the CEOs: --brains openai:<model>,anthropic:<model>,… (or run "agentcorp setup", or "agentcorp offline")');
    brains = given;
  }
  const templates = list(args, 'templates');
  const template = str(args, 'template');
  const names = list(args, 'names') ?? [];
  if (templates && templates.length !== brains.length) throw new Error(`--templates needs ${brains.length} entries (one per brain)`);
  return {
    title: cmd === 'run' ? 'Single company' : cmd === 'offline' ? 'Offline league' : 'League',
    seed: Math.floor(num(args, 'seed', base.seed)),
    weeks: Math.floor(num(args, 'weeks', base.weeks)),
    scenario: str(args, 'scenario', base.scenario)!,
    decideEvery: Math.floor(num(args, 'decide-every', 4)),
    tokenCharge: num(args, 'token-charge', 0),
    budget: budgetOf(args),
    companies: brains.map((brain, i) => ({ brain, template: templates?.[i] ?? template ?? 'saas', name: names[i] })),
  };
}

function leagueToConfig(l: LeagueSetup, args: Args): SimConfig {
  return {
    title: 'League', seed: l.seed, weeks: l.weeks, scenario: l.scenario, decideEvery: l.decideEvery ?? 4,
    tokenCharge: num(args, 'token-charge', 0), budget: budgetOf(args), companies: l.companies,
  };
}

/** Open browser setup on first launch; keep unattended runs headless. */
async function startCmd(args: Args): Promise<number> {
  if (args.setup) return webSetup(args);
  const cfg = loadConfig();
  if (cfg?.league) return liveRun(leagueToConfig(cfg.league, args), args);
  return args.headless ? runCmd('offline', args) : webSetup(args);
}

async function setupCmd(args: Args): Promise<number> {
  if (args.web) return webSetup(args);
  if (!process.stdin.isTTY) { console.error('setup needs an interactive terminal; try "agentcorp setup --web"'); return 1; }
  await runWizard(str(args, 'lang'), { free: !!args.free });
  return 0;
}

async function webSetup(args: Args): Promise<number> {
  const server = await serve({
    port: Math.floor(num(args, 'port', 4747)),
    speed: num(args, 'speed', 2),
    paused: !!args.paused,
    startLeague: (league) => {
      const config = leagueToConfig(league, args);
      return createSimulation(config, config.companies.map((x) => createBrain(x.brain, { decideEvery: config.decideEvery })));
    },
  });
  console.log(`\n  ${c.bold('AgentCorp')} ${c.dim(`v${VERSION}`)} — setup\n\n  Open  ${c.cyan(server.url)}\n`);
  console.log(c.dim('  Keys are saved to your local, git-ignored configuration. Ctrl+C to stop.\n'));
  if (args.open !== false && !process.env.CI) openBrowser(server.url);
  await new Promise(() => {});
  return 0;
}

async function modelsCmd(args: Args): Promise<number> {
  const prov = args._[1] as ProviderId | undefined;
  const all = PROVIDERS.map((p) => p.id);
  if (!prov || !all.includes(prov)) { console.error(`Usage: agentcorp models <${all.join('|')}>`); return 1; }
  const r = await probe(prov);
  if (!r.ok) { console.error(c.red(`${prov}: ${r.error}`)); return 1; }
  for (const m of r.models) console.log(`${prov}:${m.id}${m.label !== m.id ? c.dim(`  ${m.label}`) : ''}`);
  console.log(c.dim(`\n${r.models.length} models. Use one as --brains ${prov}:<model>`));
  return 0;
}

async function seasonCmd(args: Args): Promise<number> {
  const brains = list(args, 'brains');
  if (!brains || brains.length < 2) throw new Error('season needs --brains a,b[,c…]');
  const runs = Math.max(1, Math.floor(num(args, 'runs', 3)));
  const seed0 = Math.floor(num(args, 'seed', 1));
  const scenarios = list(args, 'scenarios') ?? [str(args, 'scenario', 'baseline')!];
  const seeds = Array.from({ length: runs }, (_, i) => seed0 + i);
  console.log(`${c.bold('AgentCorp season')} · ${brains.length} CEOs · ${scenarios.join(', ')} × ${runs} seeds\n`);
  const result = await runSeason({
    brains, template: str(args, 'template', 'saas')!, templates: list(args, 'templates'), scenarios, seeds,
    weeks: Math.floor(num(args, 'weeks', 104)), decideEvery: Math.floor(num(args, 'decide-every', 4)), budget: budgetOf(args),
    onRace: (race, i, total) => {
      const w = race.table[0];
      console.log(`${c.dim(`[${i}/${total}]`)} ${race.scenario} seed ${race.seed}: ${c.bold(w.brainLabel)} wins (${w.name}, ${fmtTokens(w.valuation)})`);
    },
  });
  console.log(`\n${c.bold('Season standings')}`);
  result.standings.forEach((s, i) => {
    const line = `${String(i + 1).padStart(2)}. ${s.brainLabel.padEnd(22)} ${String(s.points).padStart(4)} pts  ${s.wins}W ${s.podiums}P  ${s.unicorns} unicorn  ${s.deaths} dead  avg ${fmtTokens(s.avgValuation)}`;
    console.log(i === 0 ? c.green(line) : line);
  });
  const out = str(args, 'out');
  if (out) {
    fs.writeFileSync(out, out.endsWith('.html') ? seasonHtml(result) : JSON.stringify(result, null, 2));
    console.log(c.dim(`\nSaved ${out}`));
  }
  return 0;
}

async function pitchCmd(args: Args): Promise<number> {
  const file = args._[1];
  if (!file) throw new Error('Usage: agentcorp pitch <replay.json> [--company c1] [--week n]');
  const replay = readReplay(file);
  const story = (await import(pathToFileURL(path.join(WEB_DIR, 'lib', 'story.js')).href)) as {
    buildPitch: (r: Replay, id: string, idx: number, t: (k: string, p?: Record<string, unknown>) => string) => { title: string; slides: { title: string; lines: string[] }[] };
    pitchMarkdown: (deck: { title: string; slides: { title: string; lines: string[] }[] }) => string;
  };
  const lang = detectLang(str(args, 'lang') ?? loadConfig()?.lang);
  const i18n = (await import(pathToFileURL(path.join(WEB_DIR, 'lib', 'i18n.js')).href)) as {
    makeT: (dict: Record<string, string>, en: Record<string, string>, lang: string) => (k: string, p?: Record<string, unknown>) => string;
  };
  const read = (l: string) => JSON.parse(fs.readFileSync(path.join(WEB_DIR, 'locales', `${l}.json`), 'utf8')) as Record<string, string>;
  const t = i18n.makeT(read(lang), read('en'), lang);
  const id = str(args, 'company') ?? replay.league?.[0]?.id ?? replay.companies[0].id;
  const week = args.week ? Math.floor(num(args, 'week', 0)) : replay.frames[replay.frames.length - 1].week;
  const idx = replay.frames.findIndex((f) => f.week === week);
  if (!replay.companies.some((company) => company.id === id)) throw new Error(`Unknown company: ${id}`);
  if (idx < 0) throw new Error(`Week ${week} is unavailable in this replay`);
  const md = story.pitchMarkdown(story.buildPitch(replay, id, idx, t));
  const out = str(args, 'out');
  if (out) { fs.writeFileSync(out, md); console.log(`Wrote ${out}`); } else console.log(md);
  return 0;
}

async function runCmd(cmd: string, args: Args): Promise<number> {
  return liveRun(buildConfig(cmd, args), args);
}

async function liveRun(config: SimConfig, args: Args): Promise<number> {
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
