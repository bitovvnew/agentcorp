import { describe, expect, it } from 'vitest';
import {
  SEGMENTS, fmtTokens, investorScore, runwayWeeks, salaryFor, targetValuation, weeklyGrowth, founderOwnership, nextStage,
} from '../src/economy.js';
import { clamp, deriveSeed, mulberry32 } from '../src/rng.js';
import { createSimulation, DEMO_LEAGUE } from '../src/index.js';
import type { Company, Market } from '../src/types.js';

const market: Market = { week: 1, climate: 1, demand: { smb: 1, enterprise: 1, consumer: 1, developer: 1 }, churnMult: 1 };

function company(): Company {
  const sim = createSimulation({ ...DEMO_LEAGUE, companies: [{ template: 'saas', brain: 'balanced' }] });
  return sim.companies[0];
}

describe('rng', () => {
  it('is deterministic per seed', () => {
    const a = mulberry32(7), b = mulberry32(7), c = mulberry32(8);
    const xs = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(xs);
    expect(Array.from({ length: 5 }, c)).not.toEqual(xs);
    for (const x of xs) expect(x).toBeGreaterThanOrEqual(0), expect(x).toBeLessThan(1);
  });
  it('derives independent streams', () => {
    expect(deriveSeed(1, 'a')).not.toBe(deriveSeed(1, 'b'));
    expect(deriveSeed(1, 'a')).toBe(deriveSeed(1, 'a'));
  });
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
  });
});

describe('formulas', () => {
  it('formats tokens', () => {
    expect(fmtTokens(950)).toBe('◈950');
    expect(fmtTokens(12_300)).toBe('◈12.3K');
    expect(fmtTokens(4_500_000)).toBe('◈4.5M');
    expect(fmtTokens(1_250_000_000)).toBe('◈1.25B');
    expect(fmtTokens(-2_000)).toBe('-◈2.0K');
  });

  it('pays seniors more', () => {
    expect(salaryFor('engineer', 3)).toBeGreaterThan(salaryFor('engineer', 2));
    expect(salaryFor('engineer', 2)).toBeGreaterThan(salaryFor('engineer', 1));
  });

  it('computes runway', () => {
    expect(runwayWeeks(100_000, 10_000)).toBe(10);
    expect(runwayWeeks(100_000, 0)).toBe(Infinity);
    expect(runwayWeeks(100_000, -5_000)).toBe(Infinity);
  });

  it('values revenue: more revenue, higher valuation', () => {
    const c = company();
    c.revenue = 10_000;
    const low = targetValuation(c, market);
    c.revenue = 200_000;
    const high = targetValuation(c, market);
    expect(high).toBeGreaterThan(low);
    const hot = targetValuation(c, { ...market, climate: 1.5 });
    expect(hot).toBeGreaterThan(high);
  });

  it('measures growth', () => {
    const c = company();
    c.history = [1, 2, 3].map((w) => ({ week: w, revenue: 100 * 2 ** w } as never));
    expect(weeklyGrowth(c, 8)).toBeCloseTo(1, 5);
  });

  it('keeps investor score in [0, 1) and rewards traction', () => {
    const c = company();
    const base = investorScore(c, market);
    expect(base).toBeGreaterThanOrEqual(0);
    expect(base).toBeLessThan(1);
    c.revenue = 20_000; // ~1M ARR
    expect(investorScore(c, market)).toBeGreaterThan(base);
    expect(investorScore(c, { ...market, climate: 0.3 })).toBeLessThan(investorScore(c, market));
  });

  it('starts founders with ~80% and the next round is a Seed', () => {
    const c = company();
    expect(founderOwnership(c)).toBeGreaterThan(0.75);
    expect(founderOwnership(c)).toBeLessThan(0.85);
    expect(nextStage(c).name).toBe('Seed');
  });

  it('has sane segment parameters', () => {
    for (const s of Object.values(SEGMENTS)) {
      expect(s.tam).toBeGreaterThan(0);
      expect(s.churn).toBeGreaterThan(0);
      expect(s.churn).toBeLessThan(0.2);
      expect(s.cac / s.wtp).toBeGreaterThan(5); // no free customers
    }
  });
});
