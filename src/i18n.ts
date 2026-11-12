// Node-side translations for the CLI and setup wizard. Shares web/locales/*.json with the dashboard.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const LANGS = ['en', 'ru', 'kk', 'fr'] as const;
export type Lang = (typeof LANGS)[number];

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'web', 'locales');
const cache = new Map<string, Record<string, string>>();

function load(lang: string): Record<string, string> {
  if (!cache.has(lang)) {
    try {
      cache.set(lang, JSON.parse(fs.readFileSync(path.join(DIR, `${lang}.json`), 'utf8')));
    } catch {
      cache.set(lang, {});
    }
  }
  return cache.get(lang)!;
}

/** Pick a language from an explicit choice, then the OS locale, falling back to English. */
export function detectLang(explicit?: string): Lang {
  const candidates = [explicit, process.env.AGENTCORP_LANG, process.env.LC_ALL, process.env.LANG, Intl.DateTimeFormat().resolvedOptions().locale];
  for (const c of candidates) {
    if (!c) continue;
    const code = c.toLowerCase().slice(0, 2);
    if ((LANGS as readonly string[]).includes(code)) return code as Lang;
  }
  return 'en';
}

export function translator(lang: string) {
  const dict = load(lang);
  const en = load('en');
  return (key: string, params: Record<string, string | number> = {}): string => {
    const s = dict[key] ?? en[key] ?? key;
    return s.replace(/\{(\w+)(?::\w+)?\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`));
  };
}
