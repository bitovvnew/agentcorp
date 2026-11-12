// Economic constants and pure formulas. Everything here is deterministic and unit-tested.
import { clamp } from './rng.js';
import type { Company, Employee, Market, Role, Segment, Shareholder } from './types.js';

export interface SegmentParams {
  label: string;
  /** Total addressable customers (shared by every company in the segment). */
  tam: number;
  /** Weekly price customers are happy to pay. */
  wtp: number;
  /** Base weekly churn. */
  churn: number;
  /** Marketing tokens needed to win one customer at baseline. */
  cac: number;
  /** Customers a single sales rep closes per week at baseline. */
  dealsPerRep: number;
  /** Word of mouth: new customers per existing customer per week at quality 100. */
  viral: number;
  /** Infra cost per customer per week. */
  infra: number;
}

export const SEGMENTS: Record<Segment, SegmentParams> = {
  smb:        { label: 'SMB SaaS',   tam: 160_000,   wtp: 60,   churn: 0.015, cac: 1_500,  dealsPerRep: 1.2,  viral: 0.004,  infra: 4 },
  enterprise: { label: 'Enterprise', tam: 6_000,     wtp: 2600, churn: 0.006, cac: 60_000, dealsPerRep: 0.07, viral: 0.001,  infra: 110 },
  consumer:   { label: 'Consumer',   tam: 5_000_000, wtp: 2.4,  churn: 0.04,  cac: 14,     dealsPerRep: 0,    viral: 0.045,  infra: 0.3 },
  developer:  { label: 'Dev tools',  tam: 300_000,   wtp: 22,   churn: 0.014, cac: 260,    dealsPerRep: 0.35, viral: 0.022,  infra: 2.2 },
};

/** Weekly salary in tokens for a level-2 hire. */
export const BASE_SALARY: Record<Role, number> = {
  ceo: 3_400, cto: 3_900, engineer: 3_000, designer: 2_600, marketer: 2_500, sales: 2_400, cfo: 3_500, support: 1_500,
};
export const LEVEL_MULT: Record<1 | 2 | 3, number> = { 1: 0.78, 2: 1, 3: 1.38 };
export const OFFICE_PER_HEAD = 350;
export const HIRING_FEE_WEEKS = 2;
export const FOUNDER_SHARES = 9_000_000;
export const POOL_SHARES = 1_000_000;
export const UNICORN = 1_000_000_000;

export const ROLE_LABEL: Record<Role, string> = {
  ceo: 'CEO', cto: 'CTO', engineer: 'Engineer', designer: 'Designer', marketer: 'Marketer', sales: 'Sales', cfo: 'CFO', support: 'Support',
};

export function salaryFor(role: Role, level: 1 | 2 | 3): number {
  return Math.round(BASE_SALARY[role] * LEVEL_MULT[level]);
}

export function grantFor(level: 1 | 2 | 3): number {
  return level === 3 ? 90_000 : level === 2 ? 40_000 : 18_000;
}

export function active(c: Company): Employee[] {
  return c.employees.filter((e) => e.status === 'active');
}

export function payroll(c: Company): number {
  return active(c).reduce((s, e) => s + e.salary, 0);
}

/** One employee's effective output this week (0..~1.6). New hires ramp up over 4 weeks. */
export function output(e: Employee, week: number): number {
  const tenure = week - e.hiredWeek;
  const ramp = e.hiredWeek <= 0 ? 1 : clamp(0.35 + tenure * 0.18, 0.35, 1);
  const lvl = e.level === 3 ? 1.3 : e.level === 2 ? 1 : 0.75;
  return (0.35 + e.skill * 0.9) * lvl * (0.55 + e.morale * 0.45) * ramp;
}

export function roleOutput(c: Company, role: Role, week: number): number {
  return active(c).filter((e) => e.role === role).reduce((s, e) => s + output(e, week), 0);
}

export function count(c: Company, role: Role): number {
  return active(c).filter((e) => e.role === role).length;
}

/** Weekly growth rate of revenue over the last `n` weeks (0 when not measurable). */
export function weeklyGrowth(c: Company, n = 8, field: 'revenue' | 'customers' = 'revenue'): number {
  const h = c.history;
  if (h.length < 2) return 0;
  const now = h[h.length - 1][field];
  const then = h[Math.max(0, h.length - 1 - n)][field];
  const span = Math.min(n, h.length - 1);
  if (then <= 0 || now <= 0 || span <= 0) return now > 0 && then <= 0 ? 0.08 : 0;
  return Math.pow(now / then, 1 / span) - 1;
}

/** Target valuation: revenue multiple when there is revenue, a team/product floor before that. */
export function targetValuation(c: Company, market: Market): number {
  const arr = c.revenue * 52;
  const g = weeklyGrowth(c, 8);
  const quality = c.product.quality;
  const team = active(c).length;
  const floor = 1_200_000 + quality * 35_000 + team * 140_000 + c.product.features * 18_000 + c.customers * 30;
  const last = c.history[c.history.length - 1];
  const profitable = last && last.burn < 0 ? 3 : 0;
  const multiple = clamp(4 + profitable + 260 * g, 2.5, 32) * market.climate * (0.75 + quality / 220);
  return Math.max(floor * market.climate, arr * multiple);
}

export function totalShares(cap: Shareholder[]): number {
  return cap.reduce((s, h) => s + h.shares, 0);
}

export function founderOwnership(c: Company): number {
  const total = totalShares(c.capTable);
  const f = c.capTable.filter((h) => h.kind === 'founder').reduce((s, h) => s + h.shares, 0);
  return total > 0 ? f / total : 0;
}

export function weeklyCosts(c: Company): { payroll: number; office: number; infra: number; marketing: number } {
  const seg = SEGMENTS[c.product.segment];
  const debtTax = 1 + c.product.techDebt / 250;
  return {
    payroll: payroll(c),
    office: active(c).length * OFFICE_PER_HEAD,
    infra: Math.round(c.customers * seg.infra * debtTax),
    marketing: Math.round(c.marketingBudget),
  };
}

/** Runway in weeks given the last recorded burn (Infinity when profitable). */
export function runwayWeeks(cash: number, burn: number): number {
  if (burn <= 0) return Infinity;
  return Math.max(0, cash / burn);
}

export interface Stage {
  name: string;
  minArr: number;
  amount: [number, number];
}

export const STAGES: Stage[] = [
  { name: 'Seed',     minArr: 0,           amount: [1_500_000, 3_500_000] },
  { name: 'Series A', minArr: 900_000,     amount: [7_000_000, 15_000_000] },
  { name: 'Series B', minArr: 5_000_000,   amount: [22_000_000, 45_000_000] },
  { name: 'Series C', minArr: 18_000_000,  amount: [55_000_000, 110_000_000] },
  { name: 'Series D', minArr: 55_000_000,  amount: [130_000_000, 260_000_000] },
  { name: 'Series E', minArr: 120_000_000, amount: [250_000_000, 450_000_000] },
  { name: 'Growth round', minArr: 300_000_000, amount: [400_000_000, 800_000_000] },
];

export function nextStage(c: Company): Stage {
  const n = c.rounds.filter((r) => r.name !== 'Pre-seed' && r.name !== 'Bridge').length;
  return STAGES[Math.min(n, STAGES.length - 1)];
}

/** Investor appetite 0..1 for the company's next priced round. */
export function investorScore(c: Company, market: Market): number {
  const stage = nextStage(c);
  const arr = c.revenue * 52;
  const g = weeklyGrowth(c, 8);
  const bar = stage.minArr === 0 ? 120_000 : stage.minArr;
  const traction = clamp(arr / bar, 0, 1.6) / 1.6;
  const growth = c.revenue >= 1_000 ? clamp(g * 8, -0.35, 0.4) : 0;
  const team = clamp(active(c).length / 40, 0, 0.08);
  const climate = (market.climate - 1) * 0.5;
  const product = (c.product.quality - 50) / 400;
  const health = c.product.techDebt > 70 ? -0.12 : 0;
  // Burn multiple: tokens burned per token of new ARR over the last quarter. Investors hate > 3.
  const h = c.history;
  const prev = h[Math.max(0, h.length - 14)];
  const last = h[h.length - 1];
  let efficiency = 0;
  if (last && prev && last.burn > 0) {
    const newArr = (last.revenue - prev.revenue) * 52;
    const burned = h.slice(-13).reduce((s, x) => s + Math.max(0, x.burn), 0) * 4;
    const multiple = newArr > 0 ? burned / newArr : 10;
    efficiency = -0.07 * clamp(multiple - 2, 0, 5);
  }
  let score = 0.06 + traction * 0.5 + growth + team + climate + product + health + efficiency;
  if (arr < stage.minArr * 0.5) score *= 0.35;
  return clamp(score, 0, 0.97);
}

export function fmtTokens(n: number): string {
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e9) return `${s}◈${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}◈${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}◈${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${s}◈${Math.round(a)}`;
}
