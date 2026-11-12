// Provider discovery: detect keys and a local Ollama, validate keys live, and list models from each API.
// Model names are never hard-coded: whatever the provider returns is what the user can pick.
import { redact, registerSecret } from './security.js';

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'ollama';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  env: string;
  needsKey: boolean;
  keyUrl: string;
  keyHint: string;
}

export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', label: 'OpenAI', env: 'OPENAI_API_KEY', needsKey: true, keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic', env: 'ANTHROPIC_API_KEY', needsKey: true, keyUrl: 'https://console.anthropic.com/settings/keys', keyHint: 'sk-ant-…' },
  { id: 'gemini', label: 'Google Gemini', env: 'GEMINI_API_KEY', needsKey: true, keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…' },
  { id: 'openrouter', label: 'OpenRouter', env: 'OPENROUTER_API_KEY', needsKey: true, keyUrl: 'https://openrouter.ai/keys', keyHint: 'sk-or-…' },
  { id: 'ollama', label: 'Ollama (local)', env: 'OLLAMA_BASE_URL', needsKey: false, keyUrl: 'https://ollama.com/download', keyHint: 'http://localhost:11434' },
];

export interface ModelInfo {
  id: string;
  label: string;
}

export interface ProbeResult {
  ok: boolean;
  models: ModelInfo[];
  error?: string;
}

const TIMEOUT = 12_000;
const NOT_CHAT = /(embed|tts|whisper|dall-e|moderation|image|audio|realtime|transcribe|search|similarity|edit|davinci|babbage|computer-use|codex-mini)/i;

export function envKey(p: ProviderId): string | undefined {
  if (p === 'gemini') return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined;
  if (p === 'anthropic') return process.env.ANTHROPIC_API_KEY || undefined;
  const info = PROVIDERS.find((x) => x.id === p)!;
  return process.env[info.env] || undefined;
}

export function ollamaBase(base?: string): string {
  return (base || process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/v1\/?$/, '').replace(/\/$/, '');
}

/** Which providers already have credentials in the environment (values are never returned). */
export function detectEnv(): Record<ProviderId, boolean> {
  return {
    openai: !!envKey('openai'),
    anthropic: !!(envKey('anthropic') || process.env.ANTHROPIC_AUTH_TOKEN),
    gemini: !!envKey('gemini'),
    openrouter: !!envKey('openrouter'),
    ollama: false,
  };
}

async function getJson(url: string, headers: Record<string, string>, timeout = TIMEOUT): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeout) });
  if (!res.ok) {
    const body = (await res.text()).slice(0, 200);
    throw new Error(res.status === 401 || res.status === 403 ? `invalid key (HTTP ${res.status})` : `HTTP ${res.status}: ${body}`);
  }
  return res.json();
}

function sortModels(list: ModelInfo[]): ModelInfo[] {
  const seen = new Set<string>();
  return list.filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Validate credentials with the cheapest possible call (listing models costs no tokens) and return the
 * provider's own model list.
 */
export async function probe(p: ProviderId, key?: string, baseURL?: string): Promise<ProbeResult> {
  const k = key?.trim() || envKey(p);
  registerSecret(k);
  try {
    switch (p) {
      case 'openai': {
        if (!k) throw new Error('missing key');
        const base = (baseURL || process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
        const j = (await getJson(`${base}/models`, { authorization: `Bearer ${k}` })) as { data?: { id: string }[] };
        const models = (j.data ?? []).map((m) => m.id).filter((id) => !NOT_CHAT.test(id)).map((id) => ({ id, label: id }));
        return { ok: true, models: sortModels(models) };
      }
      case 'openrouter': {
        if (!k) throw new Error('missing key');
        await getJson('https://openrouter.ai/api/v1/key', { authorization: `Bearer ${k}` });
        const j = (await getJson('https://openrouter.ai/api/v1/models', {})) as { data?: { id: string; name?: string }[] };
        return { ok: true, models: sortModels((j.data ?? []).map((m) => ({ id: m.id, label: m.name || m.id }))) };
      }
      case 'gemini': {
        if (!k) throw new Error('missing key');
        const j = (await getJson('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': k })) as {
          models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
        };
        const models = (j.models ?? [])
          .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
          .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
          .filter((m) => !NOT_CHAT.test(m.id));
        return { ok: true, models: sortModels(models) };
      }
      case 'anthropic': {
        if (!k && !process.env.ANTHROPIC_AUTH_TOKEN) throw new Error('missing key');
        const mod = (await import('@anthropic-ai/sdk').catch(() => {
          throw new Error('install the SDK first: npm install @anthropic-ai/sdk');
        })) as { default: new (o?: Record<string, unknown>) => { models: { list: () => AsyncIterable<{ id: string; display_name?: string }> } } };
        const client = new mod.default(k ? { apiKey: k, timeout: TIMEOUT, maxRetries: 0 } : { timeout: TIMEOUT, maxRetries: 0 });
        const models: ModelInfo[] = [];
        for await (const m of client.models.list()) models.push({ id: m.id, label: m.display_name || m.id });
        return { ok: true, models };
      }
      case 'ollama': {
        const base = ollamaBase(baseURL);
        const j = (await getJson(`${base}/api/tags`, {}, 2_500)) as { models?: { name: string }[] };
        return { ok: true, models: sortModels((j.models ?? []).map((m) => ({ id: m.name, label: m.name }))) };
      }
    }
  } catch (err) {
    return { ok: false, models: [], error: redact(err) };
  }
}

/** Probe everything that can be probed without asking the user anything. */
export async function discover(): Promise<{ env: Record<ProviderId, boolean>; ollama: ProbeResult }> {
  const env = detectEnv();
  const ollama = await probe('ollama');
  env.ollama = ollama.ok;
  return { env, ollama };
}
