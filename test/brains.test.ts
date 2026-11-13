import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrain, parseDecision, LlmBrain, DECISION_SCHEMA, createSimulation, DEMO_LEAGUE } from '../src/index.js';
import { decideHeuristic, PERSONALITIES } from '../src/brains/heuristic.js';
import { mulberry32 } from '../src/rng.js';

const obs = () => {
  const sim = createSimulation(DEMO_LEAGUE);
  return sim.observe(sim.companies[0]);
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('createBrain', () => {
  it('builds heuristic brains from personality names', () => {
    expect(createBrain('blitzscaler').label).toBe('Blitzscaler');
    expect(createBrain('heuristic:bootstrapper').id).toBe('heuristic:bootstrapper');
    expect(createBrain('heuristic').id).toBe('heuristic:balanced');
  });

  it('rejects unknown specs with a helpful message', () => {
    vi.stubEnv('AGENTCORP_OPENAI_MODEL', '');
    expect(() => createBrain('skynet')).toThrow(/Unknown brain/);
    expect(() => createBrain('heuristic:chaotic')).toThrow(/personality/);
    expect(() => createBrain('openai')).toThrow(/name a model/);
  });

  it('requires API keys for hosted providers', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('GEMINI_API_KEY', '');
    vi.stubEnv('GOOGLE_API_KEY', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    vi.stubEnv('ANTHROPIC_AUTH_TOKEN', '');
    expect(() => createBrain('openai:some-model')).toThrow(/OPENAI_API_KEY/);
    expect(() => createBrain('gemini:some-model')).toThrow(/GEMINI_API_KEY/);
    expect(() => createBrain('anthropic:some-model')).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('accepts configured model IDs without hard-coding provider catalogs', () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test');
    vi.stubEnv('AGENTCORP_ANTHROPIC_MODEL', 'configured-claude');
    vi.stubEnv('AGENTCORP_OLLAMA_MODEL', '');
    expect(createBrain('anthropic').label).toBe('configured-claude');
    expect(createBrain('anthropic:explicit-claude').label).toBe('explicit-claude');
    expect(createBrain('ollama:installed-model').label).toBe('installed-model');
    expect(() => createBrain('ollama')).toThrow(/agentcorp models ollama/);
  });
});

describe('heuristic personalities', () => {
  it('make valid, distinct decisions', () => {
    const o = obs();
    const decisions = Object.values(PERSONALITIES).map((p) => decideHeuristic(p, o, { random: mulberry32(1) }));
    for (const d of decisions) {
      expect(['build', 'growth', 'sales', 'quality', 'efficiency']).toContain(d.focus);
      expect(d.hire.length).toBeLessThanOrEqual(4);
    }
    const budgets = new Set(decisions.map((d) => d.marketingBudget));
    expect(budgets.size).toBeGreaterThan(1);
  });

  it('cut costs when the money is running out', () => {
    const o = obs();
    o.week = 30;
    o.company.cash = 20_000;
    o.company.weeklyBurn = 15_000;
    o.company.runwayWeeks = 1;
    o.team = o.team.map((e) => ({ ...e, tenureWeeks: 20, performance: 0.9 }));
    const d = decideHeuristic(PERSONALITIES.balanced, o, { random: mulberry32(2) });
    expect(d.hire).toEqual([]);
    expect(d.focus).toBe('efficiency');
    expect(d.fire.length).toBeGreaterThan(0);
  });
});

describe('parseDecision', () => {
  it('reads plain JSON, fenced JSON and JSON with chatter', () => {
    expect(parseDecision('{"focus":"build","hire":[],"fire":[],"memo":"go"}').focus).toBe('build');
    expect(parseDecision('```json\n{"focus":"sales","memo":"a } b"}\n```').focus).toBe('sales');
    expect(parseDecision('Sure! Here you go: {"focus":"growth","nested":{"a":1}} hope that helps').focus).toBe('growth');
    expect(parseDecision('{"focus":"build","pivot":null}').pivot).toBeUndefined();
  });
  it('throws without JSON', () => {
    expect(() => parseDecision('I would rather not.')).toThrow();
  });
  it('schema lists every decision field', () => {
    expect([...DECISION_SCHEMA.required].sort()).toEqual(['fire', 'focus', 'hire', 'marketingBudget', 'memo', 'pivot', 'price', 'raise']);
  });
});

describe('LLM adapters (mocked network)', () => {
  it('OpenAI-compatible: sends the observation and returns usage', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe('test-model');
      expect(body.messages[1].content).toContain('STATE (JSON)');
      expect(new Headers(init.headers).get('authorization')).toBe('Bearer sk-test');
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"focus":"growth","hire":["marketer"],"fire":[],"price":50,"marketingBudget":5000,"pivot":null,"raise":false,"memo":"Go to market!"}' } }],
        usage: { prompt_tokens: 1200, completion_tokens: 80 },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const brain = new LlmBrain({ provider: 'openai', model: 'test-model', apiKey: 'sk-test', baseURL: 'https://example.invalid/v1' });
    const res = await brain.decide(obs(), { random: Math.random });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.decision.focus).toBe('growth');
    expect(res.usage).toEqual({ inputTokens: 1200, outputTokens: 80 });
  });

  it('Gemini: key goes in a header, never the URL', async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).not.toContain('key=');
      expect(new Headers(init.headers).get('x-goog-api-key')).toBe('g-test');
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"focus":"quality","memo":"fix"}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const brain = new LlmBrain({ provider: 'gemini', model: 'g-model', apiKey: 'g-test' });
    const res = await brain.decide(obs(), { random: Math.random });
    expect(res.decision.focus).toBe('quality');
  });

  it('retries, then reports an error instead of throwing', async () => {
    const fetchMock = vi.fn(async () => new Response('overloaded', { status: 529 }));
    vi.stubGlobal('fetch', fetchMock);
    const brain = new LlmBrain({ provider: 'ollama', model: 'x', retries: 1 });
    const res = await brain.decide(obs(), { random: Math.random });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.error).toMatch(/529/);
  });

  it('an LLM league runs end to end and the world survives bad answers', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++;
      const content = n % 3 === 0 ? 'no json here' : '{"focus":"build","hire":["engineer"],"fire":[],"price":55,"marketingBudget":3000,"pivot":null,"raise":true,"memo":"Ship it."}';
      return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 20 } }));
    }));
    const brains = [new LlmBrain({ provider: 'ollama', model: 'mock', retries: 0 }), createBrain('balanced')];
    const sim = createSimulation({ ...DEMO_LEAGUE, weeks: 24, decideEvery: 2, tokenCharge: 1, companies: [{ template: 'saas', brain: 'ollama:mock' }, { template: 'saas', brain: 'balanced' }] }, brains);
    await sim.runToEnd();
    expect(sim.finished).toBe(true);
    expect(sim.companies[0].llmTokens).toBeGreaterThan(0);
    expect(sim.companies[0].history.some((h) => h.aiSpend > 0)).toBe(true);
    expect(sim.events.some((e) => e.kind === 'memo' && e.text === 'Ship it.')).toBe(true);
  });
});

describe('free models', () => {
  it('spreads free picks across providers, local first, and skips paid models', async () => {
    const { pickFreeBrains } = await import('../src/providers.js');
    const picks = pickFreeBrains({
      ollama: [{ id: 'local-a', label: 'a', free: true }],
      openrouter: [{ id: 'paid', label: 'p' }, { id: 'x:free', label: 'x', free: true }, { id: 'y:free', label: 'y', free: true }],
      groq: [{ id: 'g1', label: 'g', free: true }],
    }, 4);
    expect(picks).toEqual(['ollama:local-a', 'groq:g1', 'openrouter:x:free', 'openrouter:y:free']);
    expect(pickFreeBrains({}, 4)).toEqual([]);
  });

  it('marks OpenRouter free models and lists Groq models via the API', async () => {
    const { probe } = await import('../src/providers.js');
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.endsWith('/key')) return new Response('{}');
      if (url.includes('openrouter')) return new Response(JSON.stringify({ data: [{ id: 'm:free', pricing: { prompt: '0', completion: '0' } }, { id: 'paid', pricing: { prompt: '0.001', completion: '0.002' } }] }));
      return new Response(JSON.stringify({ data: [{ id: 'groq-chat' }, { id: 'whisper-large', active: true }] }));
    }));
    const or = await probe('openrouter', 'sk-or-test-key-123456');
    expect(or.models.find((m) => m.id === 'm:free')?.free).toBe(true);
    expect(or.models.find((m) => m.id === 'paid')?.free).toBe(false);
    const gq = await probe('groq', 'gsk_test_key_1234567');
    expect(gq.models.map((m) => m.id)).toEqual(['groq-chat']);
    vi.stubEnv('GROQ_API_KEY', 'gsk_test_key_1234567');
    expect(createBrain('groq:groq-chat').id).toBe('groq:groq-chat');
  });
});
