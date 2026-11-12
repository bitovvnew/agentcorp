import { describe, expect, it } from 'vitest';
import { createSimulation, DEMO_LEAGUE, Simulation, sanitize, HeuristicBrain, PERSONALITIES } from '../src/index.js';
import { totalShares } from '../src/economy.js';
import type { Brain, SimConfig } from '../src/types.js';

const short: SimConfig = { ...DEMO_LEAGUE, weeks: 60 };

async function run(cfg: SimConfig) {
  const sim = createSimulation(cfg);
  await sim.runToEnd();
  return sim;
}

describe('simulation', () => {
  it('is deterministic: same seed → identical replay', async () => {
    const a = await run(short);
    const b = await run(short);
    expect(JSON.stringify(b.toReplay())).toBe(JSON.stringify(a.toReplay()));
  });

  it('different seeds produce different worlds', async () => {
    const a = await run(short);
    const b = await run({ ...short, seed: 99 });
    expect(a.companies.map((c) => c.customers)).not.toEqual(b.companies.map((c) => c.customers));
  });

  it('captures one frame per week plus the founding frame', async () => {
    const sim = await run(short);
    expect(sim.frames.length).toBe(short.weeks + 1);
    expect(sim.frames.map((f) => f.week)).toEqual(Array.from({ length: short.weeks + 1 }, (_, i) => i));
    expect(sim.finished).toBe(true);
    expect(await sim.step()).toBe(false);
  });

  it('balances the books every week: cash moves only by revenue, costs and financing', async () => {
    const sim = await run({ ...DEMO_LEAGUE, weeks: 80 });
    for (const c of sim.companies) {
      const h = c.history;
      for (let i = 1; i < h.length; i++) {
        const prev = h[i - 1], cur = h[i];
        const financing = c.rounds.filter((r) => r.week === prev.week && r.week > 0).reduce((s, r) => s + r.amount, 0);
        const expected = prev.cash + financing + cur.revenue - cur.costs;
        expect(Math.abs(cur.cash - expected)).toBeLessThan(5); // rounding only
      }
    }
  });

  it('keeps the cap table consistent and dilutes founders with each round', async () => {
    const sim = await run({ ...DEMO_LEAGUE, weeks: 104 });
    for (const c of sim.companies) {
      for (const h of c.capTable) expect(h.shares).toBeGreaterThan(0);
      expect(totalShares(c.capTable)).toBeGreaterThan(0);
    }
    const raised = sim.companies.filter((c) => c.rounds.length > 1);
    expect(raised.length).toBeGreaterThan(0);
    for (const c of raised) {
      const founders = c.capTable.filter((h) => h.kind === 'founder').reduce((s, h) => s + h.shares, 0);
      expect(founders / totalShares(c.capTable)).toBeLessThan(0.8);
    }
  });

  it('dead companies stay dead with nobody on payroll', async () => {
    const sim = await run({
      ...DEMO_LEAGUE, weeks: 104, scenario: 'ai-winter',
      companies: [{ template: 'ai-wrapper', brain: 'blitzscaler' }, { template: 'ai-wrapper', brain: 'bootstrapper' }],
    });
    const dead = sim.companies.filter((c) => c.status === 'bankrupt');
    expect(dead.length).toBeGreaterThan(0);
    for (const c of dead) {
      expect(c.employees.every((e) => e.status !== 'active')).toBe(true);
      expect(c.valuation).toBe(0);
      expect(sim.events.some((e) => e.kind === 'bankrupt' && e.companyId === c.id)).toBe(true);
      const after = sim.frames.filter((f) => f.week > (c.statusWeek ?? 0));
      for (const f of after) expect(f.companies.find((x) => x.id === c.id)!.status).toBe('bankrupt');
    }
    const table = sim.league();
    expect(table[table.length - 1].score).toBe(0);
  });

  it('ranks the league by valuation', async () => {
    const sim = await run(short);
    const t = sim.league();
    for (let i = 1; i < t.length; i++) expect(t[i - 1].score).toBeGreaterThanOrEqual(t[i].score);
    expect(t.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });

  it('produces a story: memos, hires, bounties and board meetings', async () => {
    const sim = await run(short);
    const kinds = new Set(sim.events.map((e) => e.kind));
    for (const k of ['founded', 'memo', 'hire', 'bounty', 'board', 'review']) expect(kinds.has(k as never)).toBe(true);
    const ids = sim.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('applies injected shocks', async () => {
    const sim = createSimulation(short);
    await sim.step();
    const before = sim.market.climate;
    sim.queueShock('funding-freeze');
    await sim.step();
    expect(sim.market.climate).toBeLessThan(before * 0.75);
    expect(sim.events.some((e) => e.kind === 'shock')).toBe(true);
    expect(() => sim.queueShock('nope' as never)).toThrow();
  });

  it('falls back to autopilot when a brain fails', async () => {
    const broken: Brain = { id: 'broken', label: 'Broken', kind: 'llm', decide: async () => { throw new Error('boom'); } };
    const sim = new Simulation({ ...short, weeks: 8, companies: [{ template: 'saas', brain: 'broken' }] }, [broken], new HeuristicBrain(PERSONALITIES.balanced));
    await sim.runToEnd();
    expect(sim.events.some((e) => e.kind === 'brain_error')).toBe(true);
    expect(sim.companies[0].status).not.toBe('bankrupt');
  });

  it('lets LLM brains decide only every N weeks', async () => {
    let calls = 0;
    const counting: Brain = {
      id: 'count', label: 'Counter', kind: 'llm',
      decide: async (obs, ctx) => { calls++; return new HeuristicBrain(PERSONALITIES.balanced).decide(obs, ctx); },
    };
    const sim = new Simulation({ ...short, weeks: 12, decideEvery: 4, companies: [{ template: 'saas', brain: 'x' }] }, [counting]);
    await sim.runToEnd();
    expect(calls).toBe(3);
  });

  it('gives brains a complete observation', () => {
    const sim = createSimulation(short);
    const obs = sim.observe(sim.companies[0]);
    expect(obs.company.cash).toBeGreaterThan(0);
    expect(obs.team.length).toBeGreaterThan(0);
    expect(obs.competitors.length).toBe(3);
    expect(obs.goal).toMatch(/unicorn/);
    expect(JSON.stringify(obs)).not.toMatch(/skill/); // hidden ability is never revealed
  });
});

describe('sanitize', () => {
  it('turns garbage into a safe decision', () => {
    const sim = createSimulation(short);
    const c = sim.companies[0];
    const d = sanitize({
      focus: 'world-domination' as never,
      hire: ['ceo', 'engineer', 'wizard', 'sales', 'sales', 'sales', 'sales'] as never,
      fire: [c.employees[0].id, 'ghost', c.employees[1].id, c.employees[1].id],
      price: -5,
      marketingBudget: 1e12,
      pivot: 'mars' as never,
      raise: 'yes' as never,
      memo: 'x'.repeat(1000),
    }, c);
    expect(d.focus).toBe(c.focus);
    expect(d.hire).toEqual(['engineer', 'sales', 'sales', 'sales']);
    expect(d.fire).toEqual([c.employees[1].id]); // CEO protected, unknown ids dropped, de-duplicated
    expect(d.price).toBeUndefined();
    expect(d.marketingBudget).toBeLessThanOrEqual(c.cash / 6);
    expect(d.pivot).toBeUndefined();
    expect(d.raise).toBe(false);
    expect(d.memo.length).toBeLessThanOrEqual(280);
  });

  it('accepts undefined', () => {
    const sim = createSimulation(short);
    const d = sanitize(undefined, sim.companies[0]);
    expect(d.hire).toEqual([]);
    expect(d.fire).toEqual([]);
  });
});
