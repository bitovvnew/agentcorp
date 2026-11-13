// Terminal setup wizard: providers → keys (validated live) → models (from each API) → league → save.
import readline from 'node:readline';
import { PERSONALITIES } from './brains/index.js';
import { loadConfig, saveConfig, applyConfig, configPath, type AgentCorpConfig } from './config.js';
import { listScenarios, listTemplates } from './plugins/index.js';
import { PROVIDERS, discover, envKey, probe, pickFreeBrains, type ModelInfo, type ProviderId } from './providers.js';
import { maskKey } from './security.js';
import { detectLang, LANGS, translator } from './i18n.js';
import type { CompanySpec } from './types.js';

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const b = (s: string) => (tty ? `\x1b[1m${s}\x1b[22m` : s);
const dim = (s: string) => (tty ? `\x1b[2m${s}\x1b[22m` : s);
const ok = (s: string) => (tty ? `\x1b[32m${s}\x1b[39m` : s);
const bad = (s: string) => (tty ? `\x1b[31m${s}\x1b[39m` : s);
const acc = (s: string) => (tty ? `\x1b[33m${s}\x1b[39m` : s);

class Prompt {
  private rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  private muted = false;
  constructor() {
    const out = (this.rl as unknown as { _writeToOutput: (s: string) => void });
    const orig = out._writeToOutput.bind(this.rl);
    out._writeToOutput = (s: string) => orig(this.muted && !s.includes('\n') ? '•'.repeat(Math.min(1, s.length)) : s);
  }
  ask(q: string, def = ''): Promise<string> {
    return new Promise((r) => this.rl.question(`${q}${def ? dim(` [${def}]`) : ''} `, (a) => r(a.trim() || def)));
  }
  async secret(q: string): Promise<string> {
    process.stdout.write(`${q} `);
    this.muted = true;
    const a = await new Promise<string>((r) => this.rl.question('', r));
    this.muted = false;
    process.stdout.write('\n');
    return a.trim();
  }
  close() { this.rl.close(); }
}

function pickFrom<T>(items: T[], answer: string, fallback: T): T {
  const n = Number(answer);
  return Number.isInteger(n) && n >= 1 && n <= items.length ? items[n - 1] : fallback;
}

export async function runWizard(langArg?: string, opts: { free?: boolean } = {}): Promise<AgentCorpConfig> {
  const p = new Prompt();
  try {
    const prev = loadConfig() ?? { version: 1 as const, keys: {} };
    // 0. language
    let lang = detectLang(langArg || prev.lang);
    let t = translator(lang);
    console.log(`\n${b('AgentCorp')} — ${t('cli.wizard.title')}\n`);
    const langs = LANGS.map((l, i) => `${i + 1}) ${translator(l)('lang.name')}`).join('  ');
    lang = pickFrom([...LANGS], await p.ask(`${t('cli.wizard.lang')}\n${dim(langs)}\n>`, String(LANGS.indexOf(lang) + 1)), lang);
    t = translator(lang);

    // 1. discovery
    console.log(`\n${b('1/4')} ${t('cli.wizard.detecting')}`);
    const found = await discover();
    for (const pr of PROVIDERS) {
      const has = pr.id === 'ollama' ? found.ollama.ok : found.env[pr.id] || !!prev.keys[pr.id];
      const note = pr.id === 'ollama'
        ? (found.ollama.ok ? t('cli.wizard.ollamaFound', { n: found.ollama.models.length }) : t('cli.wizard.ollamaMissing'))
        : found.env[pr.id] ? t('cli.wizard.inEnv') : prev.keys[pr.id] ? t('cli.wizard.saved', { key: maskKey(prev.keys[pr.id]) }) : t('cli.wizard.notSet');
      console.log(`  ${has ? ok('●') : dim('○')} ${pr.label.padEnd(16)} ${dim(note)}`);
    }

    // 2. keys
    console.log(`\n${b('2/4')} ${t('cli.wizard.keys')}`);
    const keys = { ...prev.keys };
    const models: Partial<Record<ProviderId, ModelInfo[]>> = {};
    if (found.ollama.ok) models.ollama = found.ollama.models;
    for (const pr of PROVIDERS.filter((x) => x.needsKey)) {
      const existing = keys[pr.id] || envKey(pr.id);
      const want = (await p.ask(`  ${pr.label}: ${existing ? t('cli.wizard.useExisting') : t('cli.wizard.addKey')} (${existing ? 'y/n/new' : 'y/n'})`, existing ? 'y' : 'n')).toLowerCase();
      if (!want.startsWith('y') && want !== 'new') continue;
      let key = existing;
      if (!existing || want === 'new') key = await p.secret(`    ${t('cli.wizard.pasteKey', { url: pr.keyUrl })}`);
      if (!key) continue;
      process.stdout.write(`    ${t('cli.wizard.validating')} `);
      const r = await probe(pr.id, key);
      if (r.ok) {
        console.log(ok(t('cli.wizard.valid', { n: r.models.length })));
        models[pr.id] = r.models;
        if (key !== envKey(pr.id)) keys[pr.id] = key;
      } else {
        console.log(bad(t('cli.wizard.invalid', { error: r.error ?? '?' })));
      }
    }

    // 3. league
    console.log(`\n${b('3/4')} ${t('cli.wizard.league')}`);
    const options: { spec: string; label: string }[] = [];
    for (const [prov, list] of Object.entries(models) as [ProviderId, ModelInfo[]][]) {
      for (const m of list) options.push({ spec: `${prov}:${m.id}`, label: `${prov}:${m.id}${m.free ? `  [${t('setup.freeBadge')}]` : ''}` });
    }
    for (const x of Object.values(PERSONALITIES)) options.push({ spec: x.id, label: `${t('cli.wizard.offline')}: ${x.label}` });
    const size = Math.max(2, Math.min(8, Number(await p.ask(`  ${t('cli.wizard.howMany')}`, '4')) || 4));
    const companies: CompanySpec[] = [];
    const free = pickFreeBrains(models, size);
    const goFree = (opts.free || free.length > 0) && (opts.free || (await p.ask(`  ${t('cli.wizard.free', { n: free.length })}`, free.length ? 'y' : 'n')).toLowerCase().startsWith('y'));
    if (goFree) {
      if (!free.length) console.log(`  ${acc(t('setup.freeNone'))}`);
      const offline = Object.keys(PERSONALITIES);
      for (let i = 0; i < size; i++) companies.push({ brain: free[i] ?? offline[i % offline.length], template: 'saas' });
      console.log(companies.map((c, k) => `    ${dim(String(k + 1))}) ${c.brain}`).join('\n'));
    }
    const filterable = options.length > 30;
    for (let i = companies.length; i < size; i++) {
      let pool = options;
      if (filterable) {
        const f = await p.ask(`  ${t('cli.wizard.filter', { n: i + 1 })}`, '');
        if (f) pool = options.filter((o) => o.label.toLowerCase().includes(f.toLowerCase()));
        if (!pool.length) pool = options;
      }
      const shown = pool.slice(0, 40);
      console.log(shown.map((o, k) => `    ${dim(String(k + 1).padStart(2))}) ${o.label}`).join('\n'));
      const fallback = shown[Math.min(i, shown.length - 1)];
      const pick = pickFrom(shown, await p.ask(`  ${t('cli.wizard.ceoFor', { n: i + 1 })}`, String(shown.indexOf(fallback) + 1)), fallback);
      companies.push({ brain: pick.spec, template: 'saas' });
    }
    const templates = listTemplates();
    console.log(templates.map((x, k) => `    ${dim(String(k + 1))}) ${x.id.padEnd(12)} ${dim(x.name)}`).join('\n'));
    const tpl = pickFrom(templates, await p.ask(`  ${t('cli.wizard.template')}`, '1'), templates[0]);
    const scenarios = listScenarios();
    console.log(scenarios.map((x, k) => `    ${dim(String(k + 1))}) ${x.id.padEnd(12)} ${dim(x.name)}`).join('\n'));
    const sc = pickFrom(scenarios, await p.ask(`  ${t('cli.wizard.scenario')}`, '1'), scenarios[0]);
    const weeks = Math.max(8, Math.min(260, Number(await p.ask(`  ${t('cli.wizard.weeks')}`, '104')) || 104));
    for (const c of companies) c.template = tpl.id;

    // 4. save
    const cfg: AgentCorpConfig = { ...prev, version: 1, lang, keys, league: { companies, scenario: sc.id, weeks, seed: Math.floor(Math.random() * 1e6), decideEvery: 4 } };
    const file = saveConfig(cfg);
    applyConfig(cfg);
    console.log(`\n${b('4/4')} ${ok(t('cli.wizard.savedTo', { file }))}`);
    console.log(dim(`  ${t('cli.wizard.private')}`));
    console.log(`\n  ${acc(t('cli.wizard.next'))}  ${b('npx github:bitovvnew/agentcorp')}\n`);
    return cfg;
  } finally {
    p.close();
  }
}

export { configPath };
