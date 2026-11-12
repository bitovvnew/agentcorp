import type { Rng } from '../rng.js';
import type { Market, Role, Segment } from '../types.js';

/** A company template: the starting team, product and bank balance. */
export interface CompanyTemplate {
  kind: 'template';
  id: string;
  name: string;
  description: string;
  segment: Segment;
  cash: number;
  team: { role: Role; level: 1 | 2 | 3 }[];
  product: { quality: number; features: number; techDebt: number; brand: number; price: number };
  marketingBudget: number;
  /** Company names picked from (seeded) when the user does not provide one. */
  names: string[];
  taglines: string[];
}

export interface ScenarioContext {
  market: Market;
  week: number;
  weeks: number;
  rng: Rng;
  /** Post a market-wide headline to #market. importance 3 = top story. */
  headline(text: string, importance?: 1 | 2 | 3): void;
}

/** A scenario shapes the market over time: funding climate, demand, churn, shocks. */
export interface Scenario {
  kind: 'scenario';
  id: string;
  name: string;
  description: string;
  onWeek(ctx: ScenarioContext): void;
}

export type Plugin = CompanyTemplate | Scenario;
