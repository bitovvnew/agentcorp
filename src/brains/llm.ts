// LLM-backed CEOs. Each adapter turns an Observation into a Decision.
// Keys are read from the environment only, and never written to replays or logs.
import type { Brain, BrainContext, BrainResult, BrainUsage, Decision, Observation } from '../types.js';
import { DECISION_SCHEMA, SYSTEM_PROMPT, parseDecision, userPrompt } from './prompt.js';
import { limiterFor, redact, registerSecret } from '../security.js';
import { ollamaBase } from '../providers.js';

export type Provider = 'openai' | 'anthropic' | 'gemini' | 'ollama' | 'openrouter' | 'openai-compatible';

export interface LlmOptions {
  provider: Provider;
  model: string;
  /** Display label in the league, e.g. "claude-opus-5-5". */
  label?: string;
  apiKey?: string;
  baseURL?: string;
  timeoutMs?: number;
  retries?: number;
  decideEvery?: number;
}

type Call = (system: string, user: string, signal: AbortSignal) => Promise<{ text: string; usage?: BrainUsage }>;

export class LlmBrain implements Brain {
  readonly kind = 'llm' as const;
  readonly id: string;
  readonly label: string;
  private readonly call: Call;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly decideEvery: number;

  constructor(readonly options: LlmOptions) {
    this.id = `${options.provider}:${options.model}`;
    this.label = options.label ?? options.model;
    this.timeoutMs = options.timeoutMs ?? 90_000;
    this.retries = options.retries ?? 2;
    this.decideEvery = options.decideEvery ?? 4;
    this.call = makeCall(options);
  }

  async decide(obs: Observation, _ctx: BrainContext): Promise<BrainResult> {
    const user = userPrompt(obs, this.decideEvery);
    let lastErr: unknown;
    let usage: BrainUsage = { inputTokens: 0, outputTokens: 0 };
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const res = await limiterFor(this.options.provider).run(() => this.call(SYSTEM_PROMPT, user, AbortSignal.timeout(this.timeoutMs)));
        if (res.usage) usage = { inputTokens: usage.inputTokens + res.usage.inputTokens, outputTokens: usage.outputTokens + res.usage.outputTokens };
        const decision = parseDecision(res.text) as Decision;
        return { decision, usage };
      } catch (err) {
        lastErr = err;
        const retryAfter = (err as { retryAfterMs?: number }).retryAfterMs;
        if (attempt < this.retries) await sleep(Math.min(30_000, retryAfter ?? 800 * 2 ** attempt));
      }
    }
    const msg = redact(lastErr);
    return { decision: undefined as unknown as Decision, usage, error: msg };
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function makeCall(o: LlmOptions): Call {
  switch (o.provider) {
    case 'anthropic': return anthropicCall(o);
    case 'gemini': return geminiCall(o);
    case 'ollama': return openAiCompatibleCall({ ...o, baseURL: `${ollamaBase(o.baseURL)}/v1`, apiKey: o.apiKey ?? 'ollama' });
    case 'openrouter': return openAiCompatibleCall({ ...o, baseURL: o.baseURL ?? 'https://openrouter.ai/api/v1', apiKey: o.apiKey ?? process.env.OPENROUTER_API_KEY });
    case 'openai': return openAiCompatibleCall({ ...o, baseURL: o.baseURL ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1', apiKey: o.apiKey ?? process.env.OPENAI_API_KEY });
    case 'openai-compatible': return openAiCompatibleCall({ ...o, baseURL: o.baseURL ?? process.env.AGENTCORP_BASE_URL, apiKey: o.apiKey ?? process.env.AGENTCORP_API_KEY });
    default: throw new Error(`Unknown provider: ${String(o.provider)}`);
  }
}

/** OpenAI Chat Completions — also used for Ollama and any OpenAI-compatible server. */
function openAiCompatibleCall(o: LlmOptions): Call {
  if (!o.baseURL) throw new Error(`${o.provider}: set a base URL (AGENTCORP_BASE_URL)`);
  if (!o.apiKey) throw new Error(`${o.provider}: missing API key (set ${o.provider === 'openai' ? 'OPENAI_API_KEY' : o.provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'AGENTCORP_API_KEY'}, or run agentcorp setup)`);
  registerSecret(o.apiKey);
  const url = `${o.baseURL.replace(/\/$/, '')}/chat/completions`;
  return async (system, user, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
      body: JSON.stringify({
        model: o.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!res.ok) throw httpError(o.provider, res, await res.text());
    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    return { text, usage: { inputTokens: json.usage?.prompt_tokens ?? 0, outputTokens: json.usage?.completion_tokens ?? 0 } };
  };
}

/** Google Gemini generateContent REST API (key sent as a header, never in the URL). */
function geminiCall(o: LlmOptions): Call {
  const key = o.apiKey ?? process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (!key) throw new Error('gemini: missing API key (set GEMINI_API_KEY, or run agentcorp setup)');
  registerSecret(key);
  const base = (o.baseURL ?? 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');
  const url = `${base}/models/${encodeURIComponent(o.model)}:generateContent`;
  return async (system, user, signal) => {
    const res = await fetch(url, {
      method: 'POST',
      signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) throw httpError('gemini', res, await res.text());
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
    return { text, usage: { inputTokens: json.usageMetadata?.promptTokenCount ?? 0, outputTokens: json.usageMetadata?.candidatesTokenCount ?? 0 } };
  };
}

/**
 * Anthropic Messages API through the official SDK (an optional dependency, loaded lazily so the
 * keyless demo never needs it). Structured outputs constrain the reply to the decision schema, and
 * server-side refusal fallbacks are enabled by default.
 */
function anthropicCall(o: LlmOptions): Call {
  if (!o.apiKey && !process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    throw new Error('anthropic: missing credentials (set ANTHROPIC_API_KEY, or run agentcorp setup)');
  }
  registerSecret(o.apiKey ?? process.env.ANTHROPIC_API_KEY);
  let clientPromise: Promise<unknown> | undefined;
  const getClient = async () => {
    clientPromise ??= import('@anthropic-ai/sdk').then((m) => {
      const Anthropic = (m as { default: new (opts?: Record<string, unknown>) => unknown }).default;
      return new Anthropic({ ...(o.apiKey ? { apiKey: o.apiKey } : {}), ...(o.baseURL ? { baseURL: o.baseURL } : {}) });
    }).catch(() => {
      throw new Error('anthropic: install the SDK first — npm install @anthropic-ai/sdk');
    });
    return clientPromise;
  };
  return async (system, user, signal) => {
    // The SDK's types may predate newer request fields, so the request is typed loosely here.
    const client = (await getClient()) as {
      beta: { messages: { create: (body: Record<string, unknown>, opts?: Record<string, unknown>) => Promise<AnthropicReply> } };
    };
    const msg = await client.beta.messages.create({
      model: o.model,
      max_tokens: 16_000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system,
      messages: [{ role: 'user', content: user }],
      output_config: { format: { type: 'json_schema', schema: DECISION_SCHEMA } },
    }, { signal });
    if (msg.stop_reason === 'refusal') throw new Error(`anthropic: request declined (${msg.stop_details?.category ?? 'no category'})`);
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return { text, usage: { inputTokens: msg.usage?.input_tokens ?? 0, outputTokens: msg.usage?.output_tokens ?? 0 } };
  };
}

function httpError(provider: string, res: Response, body: string): Error {
  const err = new Error(`${provider} HTTP ${res.status}: ${redact(body.slice(0, 200))}`) as Error & { retryAfterMs?: number };
  const ra = Number(res.headers.get('retry-after'));
  if (res.status === 429 && Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000;
  return err;
}

interface AnthropicReply {
  stop_reason?: string;
  stop_details?: { category?: string | null } | null;
  content: { type: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}
