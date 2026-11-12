import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEMPLATES } from './templates/index.js';
import { SCENARIOS } from './scenarios/index.js';
import type { CompanyTemplate, Plugin, Scenario } from './types.js';

export type { CompanyTemplate, Scenario, ScenarioContext, Plugin } from './types.js';
export { TEMPLATES, SCENARIOS };

const templates = new Map<string, CompanyTemplate>(TEMPLATES.map((t) => [t.id, t]));
const scenarios = new Map<string, Scenario>(SCENARIOS.map((s) => [s.id, s]));

export function registerPlugin(p: Plugin): void {
  if (!p || typeof p !== 'object' || !('kind' in p)) throw new Error('Plugin must export an object with a "kind" field');
  if (p.kind === 'template') {
    validateTemplate(p);
    templates.set(p.id, p);
  } else if (p.kind === 'scenario') {
    if (typeof p.onWeek !== 'function') throw new Error(`Scenario "${p.id}" needs an onWeek(ctx) function`);
    scenarios.set(p.id, p);
  } else {
    throw new Error(`Unknown plugin kind: ${(p as { kind: string }).kind}`);
  }
}

function validateTemplate(t: CompanyTemplate) {
  if (!t.id || !t.segment || !Array.isArray(t.team) || !t.team.some((m) => m.role === 'ceo')) {
    throw new Error(`Template "${t.id}" must have an id, a segment and a team with a CEO`);
  }
}

/** Load plugin files (.js/.mjs) exporting a plugin (or an array of plugins) as default. */
export async function loadPluginFile(file: string): Promise<Plugin[]> {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) throw new Error(`Plugin file not found: ${file}`);
  const mod = await import(pathToFileURL(abs).href);
  const exported = mod.default ?? mod.plugin ?? mod.plugins;
  const list: Plugin[] = Array.isArray(exported) ? exported : [exported];
  list.forEach(registerPlugin);
  return list;
}

export function getTemplate(id: string): CompanyTemplate {
  const t = templates.get(id);
  if (!t) throw new Error(`Unknown template "${id}". Available: ${[...templates.keys()].join(', ')}`);
  return t;
}

export function getScenario(id: string): Scenario {
  const s = scenarios.get(id);
  if (!s) throw new Error(`Unknown scenario "${id}". Available: ${[...scenarios.keys()].join(', ')}`);
  return s;
}

export function listTemplates(): CompanyTemplate[] {
  return [...templates.values()];
}

export function listScenarios(): Scenario[] {
  return [...scenarios.values()];
}
