// Built-in rule-based CEOs. They need no API key, are fully deterministic for a given seed,
// and each has a distinct management style so a keyless league is still a real contest.
import { SEGMENTS } from '../economy.js';
import { MEMOS } from '../narrative.js';
import type { Brain, BrainContext, BrainResult, Decision, Focus, Observation, Role, Segment } from '../types.js';

export interface Personality {
  id: string;
  label: string;
  blurb: string;
  /** Weeks of runway the CEO wants to keep after new hires. */
  runwayTarget: number;
  hireAggro: number;
  /** Share of (revenue + cash/40) spent on marketing each week. */
  mktShare: number;
  priceFactor: number;
  /** Start fundraising when runway drops below this many weeks. */
  raiseRunway: number;
  /** Raise opportunistically when the market is hot. */
  raiseWhenHot: boolean;
  /** Keep marketing within current profits when runway is below target. */
  profitFirst?: boolean;
  fireThreshold: number;
  /** Weeks of flat growth tolerated before pivoting (Infinity = never). */
  pivotPatience: number;
  qualityBar: number;
  flavor: string[];
}

export const PERSONALITIES: Record<string, Personality> = {
  balanced: {
    id: 'balanced', label: 'Steady Operator', blurb: 'Grows with discipline, raises before it has to, fires underperformers.',
    runwayTarget: 40, hireAggro: 1, mktShare: 0.22, priceFactor: 1, raiseRunway: 48, raiseWhenHot: true,
    fireThreshold: 0.62, pivotPatience: 44, qualityBar: 58,
    flavor: ['Steady wins.', 'Fundamentals first.', 'No heroics, just compounding.'],
  },
  blitzscaler: {
    id: 'blitzscaler', label: 'Blitzscaler', blurb: 'Hires fast, spends big on marketing, prices low, raises every chance it gets.',
    runwayTarget: 22, hireAggro: 2.3, mktShare: 0.5, priceFactor: 0.8, raiseRunway: 999, raiseWhenHot: true,
    fireThreshold: 0.45, pivotPatience: Infinity, qualityBar: 45,
    flavor: ['Speed is the only moat.', 'If we are not embarrassed, we shipped too late.', 'Growth at all costs (the costs are fine).'],
  },
  bootstrapper: {
    id: 'bootstrapper', label: 'Bootstrapper', blurb: 'Tiny burn, premium prices, hires only when revenue pays for it. Hates dilution.',
    runwayTarget: 60, hireAggro: 0.6, mktShare: 0.24, priceFactor: 1.06, raiseRunway: 12, raiseWhenHot: false, profitFirst: true,
    fireThreshold: 0.7, pivotPatience: Infinity, qualityBar: 66,
    flavor: ['Customers are the best investors.', 'Profit is a feature.', 'Every token is earned.'],
  },
  visionary: {
    id: 'visionary', label: 'Visionary', blurb: 'Product-obsessed, raises on hype, pivots when the market does not get it.',
    runwayTarget: 32, hireAggro: 1.3, mktShare: 0.2, priceFactor: 1.05, raiseRunway: 34, raiseWhenHot: true,
    fireThreshold: 0.55, pivotPatience: 26, qualityBar: 72,
    flavor: ['We are not building a product, we are building the future.', 'The market will catch up.', 'Think 10x, not 10%.'],
  },
};

/** Target team composition per segment (shares of headcount). */
const MIX: Record<Segment, Partial<Record<Role, number>>> = {
  smb:        { engineer: 0.38, marketer: 0.14, sales: 0.16, support: 0.16, designer: 0.08, cfo: 0.02 },
  enterprise: { engineer: 0.36, sales: 0.3, support: 0.14, designer: 0.06, marketer: 0.06, cfo: 0.03 },
  consumer:   { engineer: 0.4, marketer: 0.24, designer: 0.14, support: 0.12, cfo: 0.02 },
  developer:  { engineer: 0.55, support: 0.12, marketer: 0.1, designer: 0.08, sales: 0.08, cfo: 0.02 },
};

const AVG_SALARY = 2_900;

export class HeuristicBrain implements Brain {
  readonly kind = 'heuristic' as const;
  readonly id: string;
  readonly label: string;
  constructor(readonly personality: Personality) {
    this.id = `heuristic:${personality.id}`;
    this.label = personality.label;
  }

  async decide(obs: Observation, ctx: BrainContext): Promise<BrainResult> {
    return { decision: decideHeuristic(this.personality, obs, ctx) };
  }
}

export function decideHeuristic(p: Personality, obs: Observation, ctx: BrainContext): Decision {
  const c = obs.company;
  const seg = SEGMENTS[c.segment];
  const burning = c.weeklyBurn > 0;
  const runway = burning ? c.runwayWeeks : 999;
  const growth = Math.max(c.customerGrowth8w, c.revenueGrowth8w);
  const headcount = obs.team.length;

  // 1. Focus
  let focus: Focus;
  if (c.techDebt > 62) focus = 'quality';
  else if (burning && runway < 10) focus = 'efficiency';
  else if (c.quality < p.qualityBar * 0.75) focus = c.features < 6 ? 'build' : 'quality';
  else if (obs.week % 16 < 4) focus = 'build';
  else if (c.segment === 'enterprise') focus = 'sales';
  else if (c.quality < p.qualityBar) focus = c.techDebt > 40 ? 'quality' : 'build';
  else focus = c.segment === 'smb' && obs.week % 2 === 0 ? 'sales' : 'growth';

  // 2. Hiring: spend down to the runway target, filling the biggest gaps in the team mix.
  const hire: Role[] = [];
  const raisingSoon = runway < p.raiseRunway;
  const spare = c.cash / p.runwayTarget - Math.max(0, c.weeklyBurn);
  const cheapEnough = (!burning || runway > p.runwayTarget * 1.15) && spare > AVG_SALARY;
  const desperate = burning && runway < 10;
  // How big should the team be? Enough to serve customers, plus what investors expect us to build.
  const perHead = c.segment === 'enterprise' ? 25 : c.segment === 'consumer' ? 20_000 : c.segment === 'developer' ? 2_500 : 450;
  const wanted = (6 + c.customers / perHead + c.cash / 800_000) * p.hireAggro;
  if (cheapEnough && !desperate && obs.week > 1 && headcount < wanted) {
    const n = Math.min(4, Math.ceil(wanted - headcount), Math.floor((spare / AVG_SALARY) * p.hireAggro * (growth > 0.03 ? 1.4 : 0.8)));
    const counts: Partial<Record<Role, number>> = { ...obs.headcountByRole };
    const mix = MIX[c.segment];
    for (let k = 0; k < n; k++) {
      const total = Object.values(counts).reduce((s, x) => s + (x ?? 0), 0) + 1;
      let best: Role | null = null;
      let gap = -Infinity;
      for (const [role, share] of Object.entries(mix) as [Role, number][]) {
        if (role === 'cfo' && (total < 14 || (counts.cfo ?? 0) > 0)) continue;
        if (role === 'support' && c.customers < 50) continue;
        if (role === 'sales' && seg.dealsPerRep === 0) continue;
        const g = share * total - (counts[role] ?? 0) + ctx.random() * 0.3;
        if (g > gap) { gap = g; best = role; }
      }
      if (!best) break;
      hire.push(best);
      counts[best] = (counts[best] ?? 0) + 1;
    }
    if (!obs.headcountByRole.cto && hire.length < 4) hire.unshift('cto');
  }

  // 3. Firing: underperformers, and deeper cuts when the money is about to run out.
  const fire: string[] = [];
  const reviewed = obs.team.filter((e) => e.role !== 'ceo' && e.tenureWeeks >= 8).sort((a, b) => a.performance - b.performance);
  for (const e of reviewed) {
    if (fire.length >= 2) break;
    if (e.performance < p.fireThreshold) fire.push(e.id);
  }
  if (desperate && !(c.weeksSinceRaise >= 10 && obs.market.climate > 0.8)) {
    const cut = Math.ceil(headcount * 0.2);
    for (const e of reviewed) {
      if (fire.length >= cut) break;
      if (e.role !== 'cto' && !fire.includes(e.id)) fire.push(e.id);
    }
  }

  // 4. Marketing and price
  // Deploy capital: spend part of whatever cash exceeds the runway target on growth.
  const deploy = p.profitFirst ? 0 : Math.max(0, spare) * 0.45;
  let marketingBudget = p.mktShare * (c.weeklyRevenue + c.cash / 40) + deploy;
  if (burning && runway < p.runwayTarget * 0.6) marketingBudget *= 0.5;
  if (desperate) marketingBudget *= 0.3;
  if (c.segment === 'developer') marketingBudget *= 0.6;
  if (p.profitFirst && burning && runway < p.runwayTarget) {
    const profitBeforeMarketing = c.marketingBudget - c.weeklyBurn;
    marketingBudget = Math.min(marketingBudget, Math.max(400, profitBeforeMarketing));
  }
  // Never spend wildly more on marketing than the business earns.
  const cap = Math.max(40_000, c.weeklyRevenue * (p.hireAggro > 2 ? 2.5 : 1.4));
  marketingBudget = Math.round(Math.min(marketingBudget, cap, Math.max(0, c.cash) / 30));

  let price: number | undefined;
  if (obs.week % 6 === 0 || obs.week === 1) {
    const target = seg.wtp * p.priceFactor;
    price = c.price + (target - c.price) * 0.4;
    if (c.churnRate > seg.churn * 1.7) price *= 0.93;
    if (Math.abs(price - c.price) / c.price < 0.04) price = undefined;
  }

  // 5. Fundraising
  const hot = obs.market.climate > 1.15;
  const raise = c.weeksSinceRaise >= 10 && (runway < p.raiseRunway || (p.raiseWhenHot && hot && growth > 0.02));

  // 6. Pivot when the market clearly does not want this product.
  let pivot: Segment | undefined;
  if (Number.isFinite(p.pivotPatience) && c.pivots < 1 && obs.week > p.pivotPatience && obs.weeksLeft > 30 &&
      growth < 0.004 && c.customers < seg.tam * 0.01 && ctx.random() < 0.25) {
    const options = (Object.keys(SEGMENTS) as Segment[]).filter((s) => s !== c.segment);
    pivot = options[Math.floor(ctx.random() * options.length)];
  }

  // 7. Memo — only when something changes, so #general reads like a real CEO.
  let memo = '';
  if (obs.week === 1 || pivot || (focus !== c.focus && ctx.random() < 0.45)) {
    const lines = MEMOS[focus];
    memo = lines[Math.floor(ctx.random() * lines.length)];
    if (ctx.random() < 0.35) memo += ' ' + p.flavor[Math.floor(ctx.random() * p.flavor.length)];
  } else if (raise && obs.week % 3 === 0) {
    memo = runway < 20 ? 'Heads up: I am out fundraising. Runway is tight, so let\'s be careful with spend.' : 'Kicking off our next round. Keep the charts going up and to the right.';
  }

  return { focus, hire, fire, price, marketingBudget, pivot, raise, memo };
}
