import { clamp, gauss } from '../../rng.js';
import type { Scenario, ScenarioContext } from '../types.js';
import type { Segment } from '../../types.js';

const ALL: Segment[] = ['smb', 'enterprise', 'consumer', 'developer'];

/** Mean-reverting random walk shared by every scenario. */
function drift(ctx: ScenarioContext, target: number, vol = 0.025) {
  const m = ctx.market;
  m.climate = clamp(m.climate + (target - m.climate) * 0.06 + gauss(ctx.rng, vol), 0.25, 1.9);
  for (const s of ALL) m.demand[s] = clamp(m.demand[s] + (1 - m.demand[s]) * 0.05 + gauss(ctx.rng, 0.01), 0.4, 1.8);
  m.churnMult = clamp(m.churnMult + (1 - m.churnMult) * 0.08, 0.6, 2);
}

export const baseline: Scenario = {
  kind: 'scenario',
  id: 'baseline',
  name: 'Business as usual',
  description: 'A normal market with gentle cycles and one correction in year one. Good companies grow, bad ones run out of money.',
  onWeek(ctx) {
    const w = ctx.week;
    const correction = w >= 44 && w < 64;
    drift(ctx, correction ? 0.62 : 1.05 + 0.12 * Math.sin(w / 26));
    if (w === 20) ctx.headline('📈 VCs say AI-native startups are "the only thing we look at now"', 2, 'hl.baseline.20');
    if (w === 44) ctx.headline('📉 Market correction: growth-at-all-costs is out, "efficient growth" is in', 3, 'hl.baseline.44');
    if (w === 64) ctx.headline('🌤️ The correction is over. Investors are writing checks again.', 2, 'hl.baseline.64');
    if (ctx.week === 52) ctx.headline('🎂 One year in: half of last year\'s startups have quietly shut down', 2, 'hl.baseline.52');
  },
};

export const aiWinter: Scenario = {
  kind: 'scenario',
  id: 'ai-winter',
  name: 'AI winter',
  description: 'Mania for 25 weeks, then funding freezes for six months. Who saved enough runway?',
  onWeek(ctx) {
    const w = ctx.week;
    const target = w < 25 ? 1.55 : w < 52 ? 0.38 : 0.95;
    drift(ctx, target, 0.02);
    if (w === 10) ctx.headline('🚀 Seed rounds at 40x revenue are back. "This time it is different."', 2, 'hl.ai-winter.10');
    if (w === 25) {
      ctx.market.climate = 0.7;
      ctx.headline('🥶 Funding winter: top VCs tell portfolio companies to "plan for zero"', 3, 'hl.ai-winter.25');
    }
    if (w === 30) {
      for (const s of ALL) ctx.market.demand[s] *= 0.85;
      ctx.headline('📉 Customers freeze software budgets as the downturn spreads', 3, 'hl.ai-winter.30');
    }
    if (w === 52) ctx.headline('🌱 First green shoots: investors are "cautiously back"', 2, 'hl.ai-winter.52');
  },
};

export const bullRun: Scenario = {
  kind: 'scenario',
  id: 'bull-run',
  name: 'Bull run',
  description: 'Money is everywhere. Valuations go vertical. Burn rates follow. Does anyone build a real business?',
  onWeek(ctx) {
    drift(ctx, 1.65, 0.02);
    for (const s of ALL) ctx.market.demand[s] = clamp(ctx.market.demand[s] + 0.002, 0.4, 1.8);
    if (ctx.week === 8) ctx.headline('💸 A pre-product startup just raised at a ◈1B valuation. Everyone is hiring.', 3, 'hl.bull-run.8');
    if (ctx.week === 60) ctx.headline('🫧 Analysts warn of a bubble. Nobody listens.', 2, 'hl.bull-run.60');
  },
};

export const recession: Scenario = {
  kind: 'scenario',
  id: 'recession',
  name: 'Recession',
  description: 'Demand shrinks, customers churn, investors want profits. Default alive or default dead?',
  onWeek(ctx) {
    const w = ctx.week;
    drift(ctx, w < 12 ? 1 : 0.6, 0.02);
    if (w >= 12) {
      for (const s of ALL) ctx.market.demand[s] = clamp(ctx.market.demand[s] - 0.006, 0.55, 1.8);
      ctx.market.churnMult = clamp(ctx.market.churnMult + 0.03, 0.6, 1.7);
    }
    if (w === 12) ctx.headline('🏦 Central bank hikes rates again. "Profitability is the new growth."', 3, 'hl.recession.12');
    if (w === 40) ctx.headline('🧾 Layoffs.fyi tracker hits a record week', 2, 'hl.recession.40');
  },
};

export const blackSwan: Scenario = {
  kind: 'scenario',
  id: 'black-swan',
  name: 'Black swan',
  description: 'Random violent shocks: overnight crashes, viral manias, demand collapsing and coming back.',
  onWeek(ctx) {
    drift(ctx, 1, 0.04);
    const r = ctx.rng();
    if (ctx.week > 6 && r < 0.035) {
      ctx.market.climate = clamp(ctx.market.climate * 0.55, 0.25, 1.9);
      ctx.headline('💥 Flash crash: tech stocks lose a third overnight. Term sheets pulled.', 3, 'hl.black-swan.crash');
    } else if (ctx.week > 6 && r < 0.06) {
      const seg = ALL[Math.floor(ctx.rng() * ALL.length)];
      ctx.market.demand[seg] = clamp(ctx.market.demand[seg] * 1.5, 0.4, 1.8);
      ctx.headline(`🔥 Sudden demand spike in ${seg} software — buyers are panic-purchasing`, 3, { key: 'hl.black-swan.spike', params: { seg } });
    } else if (ctx.week > 6 && r < 0.08) {
      ctx.market.churnMult = clamp(ctx.market.churnMult * 1.4, 0.6, 2);
      ctx.headline('⚠️ A major cloud outage shakes trust in startups. Churn spikes.', 2, 'hl.black-swan.outage');
    }
  },
};

export const SCENARIOS: Scenario[] = [baseline, aiWinter, bullRun, recession, blackSwan];
