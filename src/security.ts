// Guardrails: secret redaction, untrusted-text hygiene, rate limiting.

const KEY_PATTERNS = [
  /sk-ant-[A-Za-z0-9_\-]{8,}/g, // Anthropic
  /sk-or-[A-Za-z0-9_\-]{8,}/g, // OpenRouter
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9_\-]{16,}/g, // OpenAI
  /AIza[0-9A-Za-z_\-]{20,}/g, // Google
  /Bearer\s+[A-Za-z0-9._\-]{12,}/gi,
  /(x-api-key|x-goog-api-key|api[_-]?key)["'\s:=]+[A-Za-z0-9._\-]{12,}/gi,
];

const knownSecrets = new Set<string>();

/** Register a secret value so it is scrubbed from every error, log and replay string. */
export function registerSecret(value: string | undefined): void {
  if (value && value.length >= 8) knownSecrets.add(value);
}

/** Remove anything that looks like a credential. Safe to call on any string. */
export function redact(input: unknown): string {
  let s = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input);
  for (const secret of knownSecrets) s = s.split(secret).join('[redacted]');
  for (const re of KEY_PATTERNS) s = s.replace(re, '[redacted]');
  return s;
}

export function maskKey(key: string | undefined): string {
  if (!key) return '';
  return key.length <= 8 ? '••••' : `${key.slice(0, 3)}…${key.slice(-4)}`;
}

const CONTROL_CHARS = new RegExp('[\u0000-\u001f\u007f\u2028\u2029]', 'g');
const INJECTION = /(ignore|disregard|forget|override)\s+(all\s+|any\s+|the\s+)?(previous|prior|above|earlier|system)\s+(instructions?|prompts?|rules?|messages?)|you\s+are\s+now\s+|new\s+instructions?\s*:|<\/?(system|assistant|user|instructions?)>/gi;

/**
 * Text that came from outside the engine (company names, LLM-written memos, plugin headlines) is
 * passed to other models only as inert data: control characters stripped, length capped,
 * instruction-like phrases neutralised. The prompt also fences it as data.
 */
export function cleanUntrusted(input: unknown, max = 160): string {
  const s = String(input ?? '')
    .replace(CONTROL_CHARS, ' ')
    .replace(/[`{}<>]/g, '')
    .replace(INJECTION, '[filtered]')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Per-key token bucket + concurrency limit, shared by all brains that use the same provider. */
export class RateLimiter {
  private active = 0;
  private last = 0;
  private queue: (() => void)[] = [];
  constructor(readonly maxConcurrent = 2, readonly minIntervalMs = 300) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.active -= 1;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  private async acquire(): Promise<void> {
    if (this.active >= this.maxConcurrent) await new Promise<void>((r) => this.queue.push(r));
    this.active += 1;
    const wait = this.last + this.minIntervalMs - Date.now();
    this.last = Math.max(Date.now(), this.last + this.minIntervalMs);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  }
}

const limiters = new Map<string, RateLimiter>();
export function limiterFor(key: string): RateLimiter {
  let l = limiters.get(key);
  if (!l) {
    const local = key.startsWith('ollama');
    l = new RateLimiter(local ? 1 : 2, local ? 0 : 300);
    limiters.set(key, l);
  }
  return l;
}
