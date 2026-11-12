import { HeuristicBrain, PERSONALITIES } from './heuristic.js';
import { LlmBrain, type Provider } from './llm.js';
import type { Brain } from '../types.js';

export { HeuristicBrain, PERSONALITIES, decideHeuristic } from './heuristic.js';
export { LlmBrain } from './llm.js';
export { SYSTEM_PROMPT, DECISION_SCHEMA, parseDecision, userPrompt } from './prompt.js';

const PROVIDERS: Provider[] = ['openai', 'anthropic', 'gemini', 'ollama', 'openai-compatible'];

export const DEFAULT_MODELS: Partial<Record<Provider, string>> = {
  anthropic: 'claude-opus-5-5',
  ollama: 'llama3.2',
};

/**
 * Brain spec strings:
 *   balanced | blitzscaler | bootstrapper | visionary      built-in heuristic CEOs (no key)
 *   heuristic:<personality>                                 same, explicit
 *   anthropic[:model]  openai:<model>  gemini:<model>  ollama[:model]  openai-compatible:<model>
 */
export function createBrain(spec: string, opts: { decideEvery?: number } = {}): Brain {
  const raw = spec.trim();
  const [head, ...rest] = raw.split(':');
  const tail = rest.join(':').trim();
  const key = head.toLowerCase();
  if (key === 'heuristic' || PERSONALITIES[key]) {
    const id = key === 'heuristic' ? (tail || 'balanced') : key;
    const p = PERSONALITIES[id];
    if (!p) throw new Error(`Unknown heuristic personality "${id}". Try: ${Object.keys(PERSONALITIES).join(', ')}`);
    return new HeuristicBrain(p);
  }
  if ((PROVIDERS as string[]).includes(key)) {
    const provider = key as Provider;
    const model = tail || DEFAULT_MODELS[provider] || envModel(provider);
    if (!model) throw new Error(`Brain "${spec}": name a model, e.g. ${provider}:<model-id>`);
    return new LlmBrain({ provider, model, decideEvery: opts.decideEvery });
  }
  throw new Error(`Unknown brain "${spec}". Use a personality (${Object.keys(PERSONALITIES).join(', ')}) or provider:model (${PROVIDERS.join(', ')}).`);
}

function envModel(p: Provider): string | undefined {
  const name = `AGENTCORP_${p.toUpperCase().replace(/-/g, '_')}_MODEL`;
  return process.env[name];
}

export function listBrains(): { spec: string; label: string; description: string }[] {
  return [
    ...Object.values(PERSONALITIES).map((p) => ({ spec: p.id, label: p.label, description: p.blurb })),
    { spec: 'anthropic[:model]', label: 'Claude', description: `Anthropic API via the official SDK (default ${DEFAULT_MODELS.anthropic}). Needs ANTHROPIC_API_KEY.` },
    { spec: 'openai:<model>', label: 'OpenAI', description: 'OpenAI Chat Completions. Needs OPENAI_API_KEY.' },
    { spec: 'gemini:<model>', label: 'Gemini', description: 'Google Gemini API. Needs GEMINI_API_KEY.' },
    { spec: 'ollama[:model]', label: 'Ollama', description: `Local models via Ollama (default ${DEFAULT_MODELS.ollama}). No key.` },
    { spec: 'openai-compatible:<model>', label: 'Any OpenAI-compatible API', description: 'OpenRouter, vLLM, LM Studio… Set AGENTCORP_BASE_URL and AGENTCORP_API_KEY.' },
  ];
}
