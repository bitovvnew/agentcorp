// Local, git-ignored configuration: provider keys, the chosen league and preferences.
// Lives in ./.agentcorp/ (or $AGENTCORP_HOME). Never committed, never logged, never put in replays.
import fs from 'node:fs';
import path from 'node:path';
import type { ProviderId } from './providers.js';
import { registerSecret } from './security.js';
import type { CompanySpec } from './types.js';

export interface LeagueSetup {
  companies: CompanySpec[];
  scenario: string;
  weeks: number;
  seed: number;
  decideEvery?: number;
}

export interface AgentCorpConfig {
  version: 1;
  lang?: string;
  keys: Partial<Record<ProviderId, string>>;
  ollamaURL?: string;
  league?: LeagueSetup;
  budget?: { perAgentTokens?: number; totalTokens?: number };
}

const ENV_FOR: Record<ProviderId, string> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  ollama: 'OLLAMA_BASE_URL',
};

export function configDir(): string {
  return path.resolve(process.env.AGENTCORP_HOME || '.agentcorp');
}

export function configPath(): string {
  return path.join(configDir(), 'config.json');
}

export function loadConfig(): AgentCorpConfig | undefined {
  try {
    const c = JSON.parse(fs.readFileSync(configPath(), 'utf8')) as AgentCorpConfig;
    if (c.version !== 1) return undefined;
    c.keys ??= {};
    return c;
  } catch {
    return undefined;
  }
}

export function saveConfig(c: AgentCorpConfig): string {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true });
  // Belt and braces: the folder ignores itself, so it can never be committed even outside this repo.
  fs.writeFileSync(path.join(dir, '.gitignore'), '*\n');
  const file = configPath();
  fs.writeFileSync(file, JSON.stringify({ ...c, version: 1 }, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch { /* Windows */ }
  return file;
}

/** Read a simple KEY=value .env file from the working directory (no expansion, no export). */
export function loadDotEnv(file = path.resolve('.env')): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (!process.env[m[1]]) process.env[m[1]] = value;
    if (/KEY|TOKEN/.test(m[1])) registerSecret(value);
  }
}

/** Put saved keys into process.env (without overriding anything already set) and mark them secret. */
export function applyConfig(c: AgentCorpConfig | undefined): void {
  if (!c) return;
  for (const [p, value] of Object.entries(c.keys) as [ProviderId, string][]) {
    if (!value) continue;
    registerSecret(value);
    const env = ENV_FOR[p];
    if (!process.env[env]) process.env[env] = value;
  }
  if (c.ollamaURL && !process.env.OLLAMA_BASE_URL) process.env.OLLAMA_BASE_URL = c.ollamaURL;
}
