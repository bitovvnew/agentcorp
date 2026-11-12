import { readFileSync, readdirSync } from 'node:fs';
import { LANGS } from '../web/lib/i18n.js';

const directory = new URL('../web/locales/', import.meta.url);
const readLocale = (lang) => JSON.parse(readFileSync(new URL(`${lang}.json`, directory), 'utf8'));
const english = readLocale('en');
const placeholders = (value) => (value.match(/\{\w+(?::\w+)?\}/g) ?? []).sort().join(',');
const errors = [];
const filenames = readdirSync(directory).filter((name) => name.endsWith('.json')).sort();
if (filenames.join(',') !== LANGS.map((lang) => `${lang}.json`).sort().join(',')) {
  errors.push('The language menu and locale files must match.');
}

for (const lang of LANGS) {
  const dictionary = readLocale(lang);
  for (const [key, source] of Object.entries(english)) {
    const translated = dictionary[key];
    if (typeof translated !== 'string' || !translated.trim()) errors.push(`${lang}: missing ${key}`);
    else if (placeholders(source) !== placeholders(translated)) errors.push(`${lang}: mismatched placeholders for ${key}`);
  }
  for (const key of Object.keys(dictionary)) {
    if (!Object.hasOwn(english, key)) errors.push(`${lang}: unexpected ${key}`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${LANGS.length} locales, ${Object.keys(english).length} messages each`);
}
