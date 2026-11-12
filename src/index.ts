// Public library API: `import { createSimulation } from 'agentcorp'`.
import { Simulation } from './engine.js';
import { createBrain, HeuristicBrain, PERSONALITIES } from './brains/index.js';
import type { Brain, SimConfig } from './types.js';

export * from './types.js';
export { Simulation, SHOCKS, VERSION, sanitize, type ShockKind } from './engine.js';
export * as economy from './economy.js';
export { fmtTokens } from './economy.js';
export { createBrain, listBrains, HeuristicBrain, LlmBrain, PERSONALITIES, SYSTEM_PROMPT, DECISION_SCHEMA, parseDecision } from './brains/index.js';
export { registerPlugin, loadPluginFile, listTemplates, listScenarios, getTemplate, getScenario } from './plugins/index.js';
export type { CompanyTemplate, Scenario, ScenarioContext, Plugin } from './plugins/index.js';
export { validateReplay } from './replay.js';

export const DEMO_LEAGUE: SimConfig = {
  title: 'Demo league',
  seed: 42,
  weeks: 104,
  scenario: 'baseline',
  companies: [
    { template: 'saas', brain: 'blitzscaler' },
    { template: 'saas', brain: 'balanced' },
    { template: 'saas', brain: 'bootstrapper' },
    { template: 'saas', brain: 'visionary' },
  ],
};

/** Build a simulation from a config, creating brains from their spec strings. */
export function createSimulation(config: SimConfig, brains?: Brain[]): Simulation {
  const list = brains ?? config.companies.map((c) => createBrain(c.brain, { decideEvery: config.decideEvery }));
  return new Simulation(config, list, new HeuristicBrain(PERSONALITIES.balanced));
}
