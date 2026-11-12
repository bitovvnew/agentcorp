// Tiny i18n: locale JSON dictionaries, ICU-lite placeholders, number/money formatting per language.
// Shared by the dashboard (browser) and the CLI (Node). No imports, so it works from a data: URL.

export const LANGS = ['en', 'ru', 'kk', 'fr'];
const INTL = { en: 'en-US', ru: 'ru-RU', kk: 'kk-KZ', fr: 'fr-FR' };

export function detectLang(saved) {
  const list = [saved, ...(typeof navigator !== 'undefined' ? navigator.languages || [navigator.language] : [])];
  for (const l of list) {
    if (!l) continue;
    const code = String(l).toLowerCase().slice(0, 2);
    if (LANGS.includes(code)) return code;
  }
  return 'en';
}

export function fmtMoney(n, lang = 'en') {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  const nf = (x, d) => x.toLocaleString(INTL[lang] || 'en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  if (a >= 1e9) return `${s}◈${nf(a / 1e9, 2)}B`;
  if (a >= 1e6) return `${s}◈${nf(a / 1e6, a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}◈${nf(a / 1e3, a >= 1e5 ? 0 : 1)}K`;
  return `${s}◈${nf(a, a >= 10 ? 0 : a >= 1 ? 1 : 2)}`;
}

export function fmtInt(n, lang = 'en') {
  return Math.round(n).toLocaleString(INTL[lang] || 'en-US');
}

/**
 * Build a translator. Placeholders: {name}, {x:money}, {x:int}, {x:pct}, {x:role}, {x:seg}, {x:focus}, {x:mood}.
 * Missing keys fall back to English, then to the key itself.
 */
export function makeT(dict, en, lang = 'en') {
  const t = (key, params = {}) => {
    const s = (dict && dict[key]) ?? (en && en[key]) ?? key;
    return String(s).replace(/\{(\w+)(?::(\w+))?\}/g, (m, k, f) => {
      const v = params[k];
      if (v === undefined || v === null) return m;
      switch (f) {
        case 'money': return fmtMoney(Number(v), lang);
        case 'int': return fmtInt(Number(v), lang);
        case 'pct': return `${Number(v) >= 0 ? '+' : ''}${Number(v)}%`;
        case 'role': return t(`role.${v}`);
        case 'seg': return t(`seg.${v}`);
        case 'focus': return t(`focus.${v}`);
        case 'mood': return t(`mood.${v}`);
        default: return String(v);
      }
    });
  };
  t.lang = lang;
  return t;
}

/** Text for a simulation event in the current language (falls back to the engine's English). */
export function eventText(ev, t) {
  if (!ev.msg) return ev.text;
  const out = t(ev.msg.key, ev.msg.params || {});
  return out === ev.msg.key ? ev.text : out;
}

const cache = {};
export async function loadLocale(lang) {
  if (cache[lang]) return cache[lang];
  const embedded = typeof window !== 'undefined' && window.__AGENTCORP_LOCALES__;
  if (embedded && embedded[lang]) return (cache[lang] = embedded[lang]);
  try {
    const res = await fetch(`locales/${lang}.json`);
    cache[lang] = res.ok ? await res.json() : {};
  } catch {
    cache[lang] = {};
  }
  return cache[lang];
}
