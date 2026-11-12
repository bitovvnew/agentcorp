// Season mode: the same CEOs play several seasons across seeds and scenarios; points decide the champion.
import { createSimulation } from './index.js';
import { createBrain } from './brains/index.js';
import type { CompanySpec, LeagueRow } from './types.js';

/** Points per finishing position (F1-style), plus bonuses. */
export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
export const UNICORN_BONUS = 5;
export const DEATH_PENALTY = -3;

export interface SeasonOptions {
  brains: string[];
  template: string;
  templates?: string[];
  scenarios: string[];
  seeds: number[];
  weeks: number;
  decideEvery?: number;
  budget?: { perAgentTokens?: number; totalTokens?: number };
  onRace?: (race: RaceResult, index: number, total: number) => void;
}

export interface RaceResult {
  seed: number;
  scenario: string;
  table: (LeagueRow & { brainSpec: string; points: number })[];
}

export interface Standing {
  brainSpec: string;
  brainLabel: string;
  points: number;
  wins: number;
  podiums: number;
  unicorns: number;
  deaths: number;
  races: number;
  avgValuation: number;
  bestValuation: number;
}

export interface SeasonResult {
  format: 'agentcorp-season';
  version: 1;
  weeks: number;
  races: RaceResult[];
  standings: Standing[];
}

export function racePoints(rank: number, status: string): number {
  const base = POINTS[rank - 1] ?? 0;
  if (status === 'bankrupt') return DEATH_PENALTY;
  return base + (status === 'unicorn' ? UNICORN_BONUS : 0);
}

export async function runSeason(o: SeasonOptions): Promise<SeasonResult> {
  if (o.brains.length < 2) throw new Error('A season needs at least two CEO brains');
  const races: RaceResult[] = [];
  const total = o.scenarios.length * o.seeds.length;
  for (const scenario of o.scenarios) {
    for (const seed of o.seeds) {
      const companies: CompanySpec[] = o.brains.map((brain, i) => ({ brain, template: o.templates?.[i] ?? o.template }));
      const brains = companies.map((c) => createBrain(c.brain, { decideEvery: o.decideEvery }));
      const sim = createSimulation({ seed, weeks: o.weeks, scenario, companies, decideEvery: o.decideEvery, budget: o.budget, title: 'Season' }, brains);
      await sim.runToEnd();
      const table = sim.league().map((r) => {
        const idx = sim.companies.findIndex((c) => c.id === r.id);
        return { ...r, brainSpec: o.brains[idx], points: racePoints(r.rank, r.status) };
      });
      const race = { seed, scenario, table };
      races.push(race);
      o.onRace?.(race, races.length, total);
    }
  }
  return { format: 'agentcorp-season', version: 1, weeks: o.weeks, races, standings: standings(races) };
}

export function standings(races: RaceResult[]): Standing[] {
  const map = new Map<string, Standing & { sum: number }>();
  for (const race of races) {
    for (const r of race.table) {
      const s = map.get(r.brainSpec) ?? {
        brainSpec: r.brainSpec, brainLabel: r.brainLabel, points: 0, wins: 0, podiums: 0, unicorns: 0, deaths: 0, races: 0,
        avgValuation: 0, bestValuation: 0, sum: 0,
      };
      s.points += r.points;
      s.races += 1;
      if (r.rank === 1) s.wins += 1;
      if (r.rank <= 3) s.podiums += 1;
      if (r.status === 'unicorn') s.unicorns += 1;
      if (r.status === 'bankrupt') s.deaths += 1;
      s.sum += r.valuation;
      s.bestValuation = Math.max(s.bestValuation, r.valuation);
      map.set(r.brainSpec, s);
    }
  }
  return [...map.values()]
    .map(({ sum, ...s }) => ({ ...s, avgValuation: s.races ? Math.round(sum / s.races) : 0 }))
    .sort((a, b) => b.points - a.points || b.wins - a.wins || b.avgValuation - a.avgValuation);
}
