// The simulation engine. One tick = one week. Every state change is recorded as an event,
// and a compact frame is captured each week, so any run can be replayed exactly.
import {
  SEGMENTS, ROLE_LABEL, UNICORN, FOUNDER_SHARES, POOL_SHARES, HIRING_FEE_WEEKS,
  active, count, grantFor, investorScore, nextStage, output, roleOutput, runwayWeeks, salaryFor,
  targetValuation, totalShares, weeklyCosts, weeklyGrowth, founderOwnership, fmtTokens, BASE_SALARY,
} from './economy.js';
import { BOUNTIES, FOCUS_LABEL, QUIT_REASONS, REJECTIONS, chatter } from './narrative.js';
import { personName, vcName } from './names.js';
import { getScenario, getTemplate, type Scenario } from './plugins/index.js';
import { chance, clamp, deriveSeed, gauss, mulberry32, pick, range, type Rng } from './rng.js';
import { cleanUntrusted, redact } from './security.js';
import type {
  Brain, Channel, Company, CompanyMeta, CompanySnapshot, Decision, Employee, EventKind, Frame,
  LeagueRow, Market, Observation, Replay, Role, Segment, SimConfig, SimEvent, WeekStat,
} from './types.js';
import { HIREABLE_ROLES, FOCUSES, SEGMENTS as SEGMENT_LIST } from './types.js';

export const VERSION = '0.1.1';

export type ShockKind = 'funding-freeze' | 'mania' | 'recession' | 'viral' | 'outage' | 'poach';
export const SHOCKS: { id: ShockKind; label: string }[] = [
  { id: 'funding-freeze', label: 'Funding freeze' },
  { id: 'mania', label: 'VC mania' },
  { id: 'recession', label: 'Recession' },
  { id: 'viral', label: 'Viral moment' },
  { id: 'outage', label: 'Major outage' },
  { id: 'poach', label: 'Poach top engineer' },
];

export type FrameListener = (frame: Frame, events: SimEvent[]) => void;

interface WeekScratch {
  bounties: number;
  fees: number;
  extraCustomers: number;
  churnMult: number;
  cashBack: number;
  acquired: number;
  churned: number;
}

const MAX_HIRES_PER_WEEK = 4;
const MAX_HEADCOUNT = 400;

export class Simulation {
  readonly config: Required<Omit<SimConfig, 'title' | 'budget'>> & { title?: string; budget: { perAgentTokens: number; totalTokens: number } };
  readonly scenario: Scenario;
  readonly companies: Company[] = [];
  readonly market: Market;
  readonly frames: Frame[] = [];
  readonly events: SimEvent[] = [];
  week = 0;
  finished = false;

  private readonly brains: Brain[];
  private readonly fallback?: Brain;
  private readonly rng: Rng;
  private readonly crng: Rng[] = [];
  private readonly brng: Rng[] = [];
  private readonly listeners = new Set<FrameListener>();
  private readonly shocks: { kind: ShockKind; companyId?: string }[] = [];
  private readonly brainErrors: number[] = [];
  private readonly milestones = new Map<string, Set<string>>();
  private readonly peakValuation = new Map<string, number>();
  private nextEventId = 1;
  private readonly budgetHit = new Set<string>();

  /** True when this company's CEO (or the whole league) has used up its LLM token budget. */
  overBudget(c: Company): boolean {
    const b = this.config.budget;
    const total = this.companies.reduce((s, x) => s + x.llmTokens, 0);
    return (!!b.perAgentTokens && c.llmTokens >= b.perAgentTokens) || (!!b.totalTokens && total >= b.totalTokens);
  }
  private pendingEvents: SimEvent[] = [];

  /**
   * @param brains one brain per company spec, in order
   * @param fallback used when a brain throws (usually the balanced heuristic)
   */
  constructor(config: SimConfig, brains: Brain[], fallback?: Brain) {
    if (!config.companies.length) throw new Error('A simulation needs at least one company');
    if (brains.length !== config.companies.length) throw new Error('Need exactly one brain per company');
    this.config = {
      seed: config.seed >>> 0,
      weeks: Math.max(1, Math.floor(config.weeks)),
      scenario: config.scenario || 'baseline',
      companies: config.companies,
      decideEvery: Math.max(1, Math.floor(config.decideEvery ?? 4)),
      tokenCharge: Math.max(0, config.tokenCharge ?? 0),
      budget: {
        perAgentTokens: config.budget?.perAgentTokens ?? 400_000,
        totalTokens: config.budget?.totalTokens ?? 2_000_000,
      },
      title: config.title,
    };
    this.brains = brains;
    this.fallback = fallback;
    this.scenario = getScenario(this.config.scenario);
    this.rng = mulberry32(deriveSeed(this.config.seed, 'market'));
    this.market = {
      week: 0,
      climate: 1,
      demand: { smb: 1, enterprise: 1, consumer: 1, developer: 1 },
      churnMult: 1,
    };
    const usedNames = new Set<string>();
    config.companies.forEach((spec, i) => {
      this.crng.push(mulberry32(deriveSeed(this.config.seed, `company-${i}`)));
      this.brng.push(mulberry32(deriveSeed(this.config.seed, `brain-${i}`)));
      this.companies.push(this.found(i, spec.template, spec.name, usedNames));
    });
    this.captureFrame();
  }

  // ───────────────────────────── setup ─────────────────────────────

  private found(i: number, templateId: string, name: string | undefined, used: Set<string>): Company {
    const tpl = getTemplate(templateId);
    const rng = this.crng[i];
    const brain = this.brains[i];
    let companyName = name?.trim();
    if (!companyName) {
      const options = tpl.names.filter((n) => !used.has(n));
      companyName = options.length ? pick(rng, options) : `${pick(rng, tpl.names)} ${i + 1}`;
    }
    used.add(companyName);
    const id = `c${i + 1}`;
    const employees: Employee[] = tpl.team.map((m, k) => this.makeEmployee(rng, `${id}-e${k + 1}`, m.role, m.level, 0, true));
    const ceo = employees.find((e) => e.role === 'ceo')!;
    const c: Company = {
      id,
      name: companyName,
      tagline: pick(rng, tpl.taglines),
      color: i,
      template: tpl.id,
      brainId: brain.id,
      brainLabel: brain.label,
      ceoName: ceo.name,
      cash: tpl.cash,
      employees,
      product: { name: companyName, segment: tpl.segment, ...tpl.product },
      customers: 0,
      customerFrac: 0,
      revenue: 0,
      marketingBudget: tpl.marketingBudget,
      focus: 'build',
      capTable: [
        { name: 'Founders', kind: 'founder', shares: FOUNDER_SHARES },
        { name: 'Angels', kind: 'investor', shares: Math.round(FOUNDER_SHARES * 0.12) },
        { name: 'Option pool', kind: 'pool', shares: POOL_SHARES },
      ],
      rounds: [{ name: 'Pre-seed', week: 0, amount: tpl.cash, preMoney: tpl.cash * 6, investor: 'Angels' }],
      valuation: tpl.cash * 7,
      status: 'operating',
      history: [],
      lastRaiseWeek: 0,
      pivots: 0,
      llmTokens: 0,
      distress: 0,
    };
    this.milestones.set(id, new Set());
    this.peakValuation.set(id, c.valuation);
    this.emit('founded', c, 'general', `🚀 ${c.name} is founded — "${c.tagline}". ${tpl.name}, ${fmtTokens(c.cash)} in the bank, ${employees.length} people. CEO brain: ${brain.label}.`, 3, ceo.name, 'ceo', undefined, { key: 'ev.founded', params: { name: c.name, tagline: c.tagline, template: tpl.id, cash: c.cash, people: employees.length, brain: brain.label } });
    return c;
  }

  private makeEmployee(rng: Rng, id: string, role: Role, level: 1 | 2 | 3, week: number, founder = false): Employee {
    const skill = founder ? range(rng, 0.5, 0.9) : clamp(range(rng, 0.2, 0.95) + (level - 2) * 0.06, 0.05, 1);
    return {
      id,
      name: personName(rng),
      role,
      level,
      salary: salaryFor(role, level),
      skill,
      morale: founder ? 0.9 : 0.8,
      performance: 1,
      hiredWeek: week,
      status: 'active',
      tasksDone: 0,
      earned: 0,
      shares: founder ? 0 : grantFor(level),
    };
  }

  // ───────────────────────────── public API ─────────────────────────────

  onFrame(listener: FrameListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  queueShock(kind: ShockKind, companyId?: string): void {
    if (!SHOCKS.some((s) => s.id === kind)) throw new Error(`Unknown shock: ${kind}`);
    this.shocks.push({ kind, companyId });
  }

  /** Advance one week. Returns false once the simulation has finished. */
  async step(): Promise<boolean> {
    if (this.finished) return false;
    this.week += 1;
    this.market.week = this.week;
    this.market.headline = undefined;

    this.scenario.onWeek({
      market: this.market,
      week: this.week,
      weeks: this.config.weeks,
      rng: this.rng,
      headline: (text, importance = 2, key) => {
        this.market.headline = stripEmoji(text);
        this.emit('market', undefined, 'market', text, importance, 'Market wire', 'market', undefined, key ? (typeof key === 'string' ? { key } : key) : undefined);
      },
    });
    this.applyShocks();

    // Brains decide in parallel (LLM calls overlap), then the world updates in a fixed order.
    const live = this.companies.filter((c) => c.status !== 'bankrupt');
    const decisions = await Promise.all(live.map((c) => this.decide(c)));
    const segmentTotals = this.segmentTotals();

    live.forEach((c, k) => {
      const scratch: WeekScratch = { bounties: 0, fees: 0, extraCustomers: 0, churnMult: 1, cashBack: 0, acquired: 0, churned: 0 };
      const d = decisions[k];
      this.applyDecision(c, d, scratch);
      this.work(c, scratch);
      this.serveMarket(c, segmentTotals, scratch);
      this.settle(c, scratch);
      if (d.raise) this.fundraise(c);
      this.people(c);
      if (this.week % 4 === 0) this.reviews(c);
      if (this.week % 13 === 0) this.boardMeeting(c);
      this.checkSurvival(c);
      this.updateValuation(c);
      this.milestoneCheck(c);
    });

    this.captureFrame();
    if (this.week >= this.config.weeks || this.companies.every((c) => c.status === 'bankrupt')) {
      this.finished = true;
      const table = this.league();
      const winner = table[0];
      if (winner) {
        this.emit('milestone', undefined, 'market', `🏁 Season over after ${this.week} weeks. Winner: ${winner.name} (${winner.brainLabel}) at ${fmtTokens(winner.valuation)}.`, 3, 'AgentCorp League', 'system', undefined, { key: 'ev.seasonOver', params: { weeks: this.week, name: winner.name, brain: winner.brainLabel, valuation: winner.valuation } });
      }
    }
    const frame = this.frames[this.frames.length - 1];
    const fresh = this.pendingEvents;
    this.pendingEvents = [];
    for (const l of this.listeners) l(frame, fresh);
    return !this.finished;
  }

  async runToEnd(onWeek?: (week: number) => void): Promise<Replay> {
    while (await this.step()) onWeek?.(this.week);
    onWeek?.(this.week);
    return this.toReplay();
  }

  league(): LeagueRow[] {
    const rows = this.companies.map((c) => {
      const stake = founderOwnership(c);
      const score = c.status === 'bankrupt' ? 0 : c.valuation;
      return {
        rank: 0,
        id: c.id,
        name: c.name,
        brainLabel: c.brainLabel,
        status: c.status,
        valuation: c.status === 'bankrupt' ? 0 : Math.round(c.valuation),
        arr: Math.round(c.revenue * 52),
        customers: Math.round(c.customers),
        headcount: active(c).length,
        cash: Math.round(c.cash),
        founderStake: stake,
        score,
      };
    });
    rows.sort((a, b) => b.score - a.score || b.arr - a.arr || (b.cash - a.cash));
    rows.forEach((r, i) => (r.rank = i + 1));
    return rows;
  }

  meta(): CompanyMeta[] {
    return this.companies.map((c) => ({
      id: c.id, name: c.name, tagline: c.tagline, color: c.color, template: c.template,
      brainId: c.brainId, brainLabel: c.brainLabel, ceoName: c.ceoName,
    }));
  }

  toReplay(): Replay {
    return {
      format: 'agentcorp-replay',
      version: 1,
      generator: `agentcorp@${VERSION}`,
      config: { ...this.config },
      scenario: { id: this.scenario.id, name: this.scenario.name, description: this.scenario.description },
      companies: this.meta(),
      frames: this.frames,
      events: this.events,
      league: this.finished ? this.league() : undefined,
      finished: this.finished,
    };
  }

  /** Build what a brain gets to see. Public so tests and custom brains can inspect it. */
  observe(c: Company): Observation {
    const seg = SEGMENTS[c.product.segment];
    const last = c.history[c.history.length - 1];
    const burn = last ? last.burn : weeklyCosts(c).payroll;
    const segTotal = this.companies.filter((x) => x.status !== 'bankrupt' && x.product.segment === c.product.segment)
      .reduce((s, x) => s + x.customers, 0);
    const byRole: Partial<Record<Role, number>> = {};
    for (const e of active(c)) byRole[e.role] = (byRole[e.role] ?? 0) + 1;
    return {
      week: this.week,
      weeksLeft: this.config.weeks - this.week + 1,
      goal: `Reach a ${fmtTokens(UNICORN)} valuation (unicorn) before week ${this.config.weeks} without running out of cash. Money is tokens (◈).`,
      company: {
        name: cleanUntrusted(c.name, 60),
        segment: c.product.segment,
        focus: c.focus,
        pivots: c.pivots,
        cash: Math.round(c.cash),
        weeklyRevenue: Math.round(c.revenue),
        weeklyBurn: Math.round(burn),
        runwayWeeks: Math.round(Math.min(999, runwayWeeks(c.cash, burn))),
        customers: Math.round(c.customers),
        customerGrowth8w: round3(weeklyGrowth(c, 8, 'customers')),
        revenueGrowth8w: round3(weeklyGrowth(c, 8, 'revenue')),
        churnRate: last && last.customers > 0 ? round3(last.churned / Math.max(1, last.customers)) : 0,
        price: round2(c.product.price),
        marketingBudget: Math.round(c.marketingBudget),
        quality: Math.round(c.product.quality),
        techDebt: Math.round(c.product.techDebt),
        brand: Math.round(c.product.brand),
        features: Math.round(c.product.features),
        valuation: Math.round(c.valuation),
        founderOwnership: round3(founderOwnership(c)),
        rounds: c.rounds.length,
        weeksSinceRaise: this.week - c.lastRaiseWeek,
        status: c.status,
      },
      team: active(c).map((e) => ({
        id: e.id, name: cleanUntrusted(e.name, 40), role: e.role, level: e.level, salary: e.salary,
        performance: round2(e.performance), morale: round2(e.morale), tenureWeeks: this.week - e.hiredWeek,
      })),
      headcountByRole: byRole,
      market: {
        climate: round2(this.market.climate),
        demand: round2(this.market.demand[c.product.segment]),
        saturation: round3(segTotal / seg.tam),
        segmentPrice: seg.wtp,
        headline: this.market.headline ? cleanUntrusted(this.market.headline) : undefined,
      },
      // Rivals are visible only as numbers and a name, never their memos or chat (no cross-agent channel).
      competitors: this.companies.filter((x) => x.id !== c.id).map((x) => ({
        name: cleanUntrusted(x.name, 60), segment: x.product.segment, valuation: Math.round(x.valuation), customers: Math.round(x.customers),
        quality: Math.round(x.product.quality), status: x.status,
      })),
      recent: this.events.filter((e) => e.companyId === c.id && e.importance >= 2).slice(-8).map((e) => `W${e.week}: ${cleanUntrusted(e.text, 200)}`),
      salaryGuide: { ...BASE_SALARY },
    };
  }

  // ───────────────────────────── week phases ─────────────────────────────

  private async decide(c: Company): Promise<Decision> {
    const i = this.companies.indexOf(c);
    const brain = this.brains[i];
    const every = brain.kind === 'llm' ? this.config.decideEvery : 1;
    const decisionWeek = (this.week - 1) % every === 0 || !c.lastDecision;
    if (!decisionWeek && c.lastDecision) {
      // Hold the standing policy; one-shot actions only happen on decision weeks.
      return { ...c.lastDecision, hire: [], fire: [], pivot: undefined, raise: false, memo: '' };
    }
    const obs = this.observe(c);
    const ctx = { random: this.brng[i] };
    let decision: Decision;
    if (brain.kind === 'llm' && this.overBudget(c)) {
      if (!this.budgetHit.has(c.id)) {
        this.budgetHit.add(c.id);
        this.emit('budget', c, 'general', `Spend cap reached (${c.llmTokens.toLocaleString('en-US')} LLM tokens). ${brain.label} is paused; autopilot runs the company.`, 2, 'System', 'system', undefined, { key: 'ev.budget', params: { tokens: c.llmTokens, brain: brain.label } });
      }
      const res = await (this.fallback ?? brain).decide(obs, ctx);
      decision = sanitize(res.decision, c);
      c.lastDecision = decision;
      return decision;
    }
    try {
      const res = await brain.decide(obs, ctx);
      decision = sanitize(res.decision, c);
      if (res.usage) {
        const tokens = res.usage.inputTokens + res.usage.outputTokens;
        c.llmTokens += tokens;
      }
      if (res.error) throw new Error(res.error);
    } catch (err) {
      this.brainErrors[i] = (this.brainErrors[i] ?? 0) + 1;
      const n = this.brainErrors[i];
      if (n === 1 || n % 10 === 0) {
        const msg = redact(err);
        this.emit('brain_error', c, 'general', `⚠️ ${brain.label} failed to decide (${msg.slice(0, 140)}). Autopilot takes over this week.`, 2, 'System', 'system', undefined, { key: 'ev.brainError', params: { brain: brain.label, msg: msg.slice(0, 140) } });
      }
      if (!this.fallback) throw err;
      const res = await this.fallback.decide(obs, ctx);
      decision = sanitize(res.decision, c);
    }
    c.lastDecision = decision;
    return decision;
  }

  private applyDecision(c: Company, d: Decision, s: WeekScratch): void {
    const rng = this.rngFor(c);
    const ceo = this.ceo(c);
    if (d.memo && d.memo !== c.lastMemo) {
      c.lastMemo = d.memo;
      this.emit('memo', c, 'general', d.memo, 2, ceo?.name ?? c.ceoName, 'ceo');
    }
    if (d.focus !== c.focus) {
      this.emit('focus', c, 'general', `🎯 New focus: ${FOCUS_LABEL[d.focus]}.`, 1, ceo?.name ?? c.ceoName, 'ceo', { focus: d.focus }, { key: 'ev.focus', params: { focus: d.focus } });
      c.focus = d.focus;
    }
    if (d.price !== undefined && Math.abs(d.price - c.product.price) / c.product.price > 0.04) {
      const up = d.price > c.product.price;
      this.emit('price', c, 'sales', `${up ? '⬆️ Price increase' : '⬇️ Price cut'}: ${fmtPrice(c.product.price)} → ${fmtPrice(d.price)} per customer/week.`, 2, ceo?.name ?? c.ceoName, 'ceo', undefined, { key: up ? 'ev.priceUp' : 'ev.priceDown', params: { from: c.product.price, to: d.price } });
      c.product.price = d.price;
    }
    if (d.marketingBudget !== undefined) c.marketingBudget = d.marketingBudget;

    if (d.pivot && d.pivot !== c.product.segment && c.pivots < 3) {
      const from = SEGMENTS[c.product.segment].label;
      const fromSeg = c.product.segment;
      const to = SEGMENTS[d.pivot];
      c.pivots += 1;
      c.product.segment = d.pivot;
      c.product.quality *= 0.55;
      c.product.features = Math.max(1, Math.round(c.product.features * 0.4));
      c.product.brand *= 0.6;
      c.customers *= 0.25;
      c.product.price = to.wtp * 0.9;
      for (const e of active(c)) e.morale = clamp(e.morale - 0.08, 0, 1);
      this.emit('pivot', c, 'general', `🔄 PIVOT! ${c.name} is leaving ${from} for ${to.label}. Most customers are gone; the roadmap starts over.`, 3, ceo?.name ?? c.ceoName, 'ceo', { to: d.pivot }, { key: 'ev.pivot', params: { name: c.name, from: fromSeg, to: d.pivot } });
    }

    for (const id of d.fire) {
      const e = c.employees.find((x) => x.id === id && x.status === 'active');
      if (!e || e.role === 'ceo') continue;
      this.letGo(c, e, 'fired', s);
    }

    let hires = 0;
    const welcomed: string[] = [];
    const hiredPeople: { name: string; role: Role; level: number; salary: number }[] = [];
    for (const role of d.hire) {
      if (hires >= MAX_HIRES_PER_WEEK || active(c).length >= MAX_HEADCOUNT) break;
      if (role === 'ceo' || !HIREABLE_ROLES.includes(role)) continue;
      if (role === 'cto' && count(c, 'cto') > 0) continue;
      if (role === 'cfo' && count(c, 'cfo') > 0) continue;
      const rich = c.cash > 20_000_000 ? 0.45 : c.cash > 4_000_000 ? 0.25 : 0.08;
      const r = rng();
      const level: 1 | 2 | 3 = r < rich ? 3 : r < rich + 0.5 ? 2 : 1;
      const fee = salaryFor(role, level) * HIRING_FEE_WEEKS;
      if (c.cash - fee < 0) break;
      const e = this.makeEmployee(rng, `${c.id}-e${c.employees.length + 1}`, role, level, this.week);
      c.employees.push(e);
      this.grantOptions(c, e.shares);
      s.fees += fee;
      hires += 1;
      const title = `${level === 3 ? 'Senior ' : level === 1 ? 'Junior ' : ''}${ROLE_LABEL[role]}`;
      welcomed.push(`${e.name} (${title}, ${fmtTokens(e.salary)}/wk)`);
      hiredPeople.push({ name: e.name, role, level, salary: e.salary });
    }
    if (welcomed.length) {
      const text = welcomed.length === 1 ? `👋 Welcome ${welcomed[0]}!` : `👋 Welcome to our ${welcomed.length} new hires: ${welcomed.join(', ')}!`;
      this.emit('hire', c, 'hr', text, 1, ceo?.name ?? c.ceoName, 'ceo', { count: welcomed.length, people: hiredPeople }, welcomed.length === 1
        ? { key: 'ev.hireOne', params: { name: hiredPeople[0].name, role: hiredPeople[0].role, level: hiredPeople[0].level, salary: hiredPeople[0].salary } }
        : { key: 'ev.hireMany', params: { count: hiredPeople.length, names: hiredPeople.map((h) => h.name).join(', ') } });
    }
  }

  private letGo(c: Company, e: Employee, why: 'fired' | 'quit', s?: WeekScratch, reason?: string): void {
    e.status = why;
    e.leftWeek = this.week;
    if (why === 'fired') {
      if (s) s.fees += e.salary * 2; // severance
      for (const o of active(c)) o.morale = clamp(o.morale - 0.02, 0, 1);
      const perf = e.performance < 0.75 ? ` Last review: ${e.performance.toFixed(2)}.` : '';
      this.emit('fire', c, 'hr', `🔥 ${e.name} (${ROLE_LABEL[e.role]}) has been let go.${perf}`, 2, this.ceo(c)?.name ?? c.ceoName, 'ceo', { role: e.role }, { key: 'ev.fire', params: { name: e.name, role: e.role } });
    } else {
      for (const o of active(c)) o.morale = clamp(o.morale - 0.015, 0, 1);
      const why2 = reason ?? pick(this.rngFor(c), QUIT_REASONS);
      this.emit('quit', c, 'hr', `🚪 ${e.name} (${ROLE_LABEL[e.role]}) resigned — "${why2}".`, 2, e.name, e.role, undefined, { key: 'ev.quit', params: { name: e.name, role: e.role, reason: why2 } });
    }
    if (e.role === 'cto' && why !== 'fired') {
      this.emit('chat', c, 'eng', 'wait, who has the prod credentials now?', 1, pick(this.rngFor(c), active(c).filter((x) => x.role === 'engineer').map((x) => x.name).concat([c.ceoName])), 'engineer');
    }
  }

  private work(c: Company, s: WeekScratch): void {
    const rng = this.rngFor(c);
    const p = c.product;
    const w = this.week;
    const drag = 1 - p.techDebt / 220;
    // Brooks's law: output grows sub-linearly with team size.
    const eng = Math.pow(roleOutput(c, 'engineer', w) + 1.25 * roleOutput(c, 'cto', w), 0.6) * drag;
    const design = Math.pow(roleOutput(c, 'designer', w), 0.6);
    const cto = roleOutput(c, 'cto', w);
    const mix = c.focus === 'build' ? 0.75 : c.focus === 'quality' ? 0.25 : c.focus === 'efficiency' ? 0.4 : 0.55;
    const featWork = eng * mix;
    const qualWork = eng * (1 - mix);

    p.features += featWork * 0.24;
    // Quality gets harder to improve the closer it is to perfect; the bar also keeps rising.
    p.quality += (qualWork * 1.3 + featWork * 0.4 + design * 1.1) * Math.pow(Math.max(0, 1 - p.quality / 100), 1.5);
    p.quality -= 0.25 + p.quality * 0.006 + (p.techDebt > 60 ? 0.5 : 0);
    p.techDebt += featWork * 0.85 - qualWork * 1.45 - cto * 0.35 + 0.15;
    const mkt = roleOutput(c, 'marketer', w);
    p.brand += mkt * (c.focus === 'growth' ? 1.25 : 0.8) + c.marketingBudget / 25_000;
    p.brand *= 0.982;
    p.quality = clamp(p.quality, 1, 100);
    p.techDebt = clamp(p.techDebt, 0, 100);
    p.brand = clamp(p.brand, 0, 100);

    // Internal task marketplace: the CEO posts bounties, employees bid, the best value wins.
    const staff = active(c).length;
    const bounties = 1 + (staff > 8 ? 1 : 0) + (staff > 25 ? 1 : 0);
    const menu = BOUNTIES[c.focus];
    for (let b = 0; b < bounties; b++) {
      const opt = pick(rng, menu);
      const candidates = active(c).filter((e) => e.role === opt.role || (opt.role === 'engineer' && e.role === 'cto'));
      if (!candidates.length) continue;
      const title = pick(rng, opt.title);
      const reward = Math.round(BASE_SALARY[opt.role] * range(rng, 0.25, 0.6));
      let best: { e: Employee; ask: number; score: number } | null = null;
      for (const e of candidates) {
        const ask = Math.round(reward * (0.55 + rng() * 0.55) * (1.15 - e.morale * 0.3));
        const score = output(e, w) / Math.max(1, ask) * (0.85 + rng() * 0.3);
        if (!best || score > best.score) best = { e, ask, score };
      }
      if (!best) continue;
      const success = chance(rng, clamp(0.3 + best.e.skill * 0.62, 0.05, 0.96) * drag);
      if (success) {
        best.e.tasksDone += 1;
        best.e.earned += best.ask;
        best.e.performance = clamp(best.e.performance + 0.04, 0, 1.6);
        s.bounties += best.ask;
        this.bountyEffect(c, opt.role, s);
        const channel: Channel = opt.role === 'sales' ? 'deals' : opt.role === 'engineer' || opt.role === 'cto' ? 'eng' : 'general';
        const kind: EventKind = opt.role === 'engineer' && c.focus === 'build' ? 'ship' : 'bounty';
        this.emit(kind, c, channel, `${kind === 'ship' ? '🚢 Shipped' : '✅ Done'}: "${title}" — ${best.e.name} won the bounty at ${fmtTokens(best.ask)} (${candidates.length} bid${candidates.length > 1 ? 's' : ''}).`, kind === 'ship' ? 2 : 1, best.e.name, best.e.role, undefined, { key: kind === 'ship' ? 'ev.ship' : 'ev.bountyDone', params: { title, name: best.e.name, ask: best.ask, bids: candidates.length } });
      } else {
        best.e.performance = clamp(best.e.performance - 0.05, 0, 1.6);
        this.emit('bounty', c, opt.role === 'sales' ? 'deals' : 'eng', `❌ "${title}" slipped. ${best.e.name} missed the deadline; bounty unpaid.`, 1, best.e.name, best.e.role, undefined, { key: 'ev.bountyFail', params: { title, name: best.e.name } });
      }
    }
  }

  private bountyEffect(c: Company, role: Role, s: WeekScratch): void {
    const p = c.product;
    const seg = SEGMENTS[p.segment];
    switch (role) {
      case 'engineer':
      case 'cto':
        if (c.focus === 'quality' || c.focus === 'efficiency') { p.techDebt = clamp(p.techDebt - 6, 0, 100); p.quality = clamp(p.quality + 2.5 * headroom(p.quality), 0, 100); }
        else { p.features += 1; p.quality = clamp(p.quality + 2 * headroom(p.quality), 0, 100); }
        break;
      case 'designer': p.quality = clamp(p.quality + 3.5 * headroom(p.quality), 0, 100); break;
      case 'marketer': p.brand = clamp(p.brand + 3, 0, 100); s.extraCustomers += (2 + Math.pow(c.marketingBudget / seg.cac, 0.7) * 0.4) * (0.4 + p.quality / 100); break;
      case 'sales': s.extraCustomers += Math.max(0.5, seg.dealsPerRep * 2) * (0.5 + p.quality / 100); break;
      case 'support': s.churnMult *= 0.85; break;
      case 'cfo': s.cashBack += weeklyCosts(c).payroll * 0.12; break;
      default: break;
    }
  }

  private segmentTotals(): Record<Segment, number> {
    const t: Record<Segment, number> = { smb: 0, enterprise: 0, consumer: 0, developer: 0 };
    for (const c of this.companies) if (c.status !== 'bankrupt') t[c.product.segment] += c.customers;
    return t;
  }

  private serveMarket(c: Company, totals: Record<Segment, number>, s: WeekScratch): void {
    const rng = this.rngFor(c);
    const p = c.product;
    const seg = SEGMENTS[p.segment];
    const w = this.week;
    const q = p.quality / 100;
    const qf = 0.25 + Math.pow(q, 1.3) * 1.5;
    const pf = clamp(Math.pow(seg.wtp / Math.max(0.01, p.price), 1.3), 0.12, 2.5);
    const bf = 1 + p.brand / 60;
    const share = clamp(totals[p.segment] / seg.tam, 0, 1);
    const sat = Math.pow(1 - share, 1.6);
    const demand = this.market.demand[p.segment];
    const mkt = roleOutput(c, 'marketer', w);
    const sales = roleOutput(c, 'sales', w);
    const mktEff = Math.min(2.4, 1 + 0.3 * mkt) * (c.focus === 'growth' ? 1.2 : 1);
    // Diminishing returns: doubling spend buys ~60% more customers, and CAC rises as the market fills up.
    const cac = seg.cac * (1 + 2.5 * share);
    const fromMarketing = Math.pow(c.marketingBudget / cac, 0.7) * mktEff * qf * pf * bf;
    const fromSales = sales * seg.dealsPerRep * Math.sqrt(qf * pf) * (c.focus === 'sales' ? 1.35 : 1);
    const fromWom = c.customers * seg.viral * q * q * Math.sqrt(pf);
    const trickle = seg.tam * 0.00006 * (p.brand / 100 + 0.15) * qf;
    // Founder-led sales: in the early days the CEO sells too.
    const founderSales = active(c).length <= 12 ? roleOutput(c, 'ceo', w) * Math.max(0.15, seg.dealsPerRep) * 3 * Math.sqrt(qf * pf) : 0;
    const noise = Math.max(0.4, 1 + gauss(rng, 0.12));
    const acquired = (fromMarketing + fromSales + fromWom + trickle + founderSales + s.extraCustomers) * demand * sat * noise;

    // Churn: bad product, high price, tech debt, thin support and better rivals all push it up.
    const capacity = p.segment === 'enterprise' ? 60 : p.segment === 'consumer' ? 50_000 : p.segment === 'developer' ? 4_000 : 1_100;
    const needed = c.customers / capacity;
    const have = roleOutput(c, 'support', w) + 0.4 + count(c, 'sales') * (p.segment === 'enterprise' ? 0.6 : 0.1);
    const supportFactor = needed > have ? clamp(1 + 0.25 * (needed - have) / Math.max(needed, 1), 1, 1.35) : 0.9;
    const rival = this.companies.some((x) => x.id !== c.id && x.status !== 'bankrupt' && x.product.segment === p.segment && x.product.quality > p.quality + 10);
    const churnRate = clamp(
      seg.churn * (1.45 - q * 0.9) * clamp(Math.pow(p.price / seg.wtp, 0.6), 0.5, 2.5) * this.market.churnMult *
      (1 + p.techDebt / 180) * supportFactor * (rival ? 1.15 : 1) * s.churnMult,
      0.0005, 0.6,
    );
    const churned = c.customers * churnRate;
    const next = Math.max(0, c.customers + c.customerFrac + acquired - churned);
    c.customers = Math.floor(next);
    c.customerFrac = next - c.customers;
    c.revenue = c.customers * p.price;
    s.acquired = acquired;
    s.churned = churned;
  }

  private settle(c: Company, s: WeekScratch): void {
    const costs = weeklyCosts(c);
    const aiSpend = this.config.tokenCharge > 0 ? this.lastTokens(c) * this.config.tokenCharge : 0;
    const total = costs.payroll + costs.office + costs.infra + costs.marketing + s.bounties + s.fees + aiSpend - s.cashBack;
    c.cash += c.revenue - total;
    const burn = total - c.revenue;
    const stat: WeekStat = {
      week: this.week,
      cash: Math.round(c.cash),
      revenue: Math.round(c.revenue),
      costs: Math.round(total),
      payroll: Math.round(costs.payroll),
      marketing: Math.round(costs.marketing),
      infra: Math.round(costs.infra + costs.office),
      bounties: Math.round(s.bounties),
      aiSpend: Math.round(aiSpend),
      burn: Math.round(burn),
      customers: c.customers,
      newCustomers: Math.round(s.acquired),
      churned: Math.round(s.churned),
      headcount: active(c).length,
      quality: round2(c.product.quality),
      valuation: Math.round(c.valuation),
      runwayWeeks: Math.round(Math.min(999, runwayWeeks(Math.max(0, c.cash), burn))),
    };
    c.history.push(stat);
  }

  private tokenMark = new Map<string, number>();
  private lastTokens(c: Company): number {
    const prev = this.tokenMark.get(c.id) ?? 0;
    this.tokenMark.set(c.id, c.llmTokens);
    return c.llmTokens - prev;
  }

  private fundraise(c: Company): void {
    if (c.status === 'bankrupt') return;
    if (this.week - c.lastRaiseWeek < 10) return;
    const rng = this.rngFor(c);
    const stage = nextStage(c);
    const score = investorScore(c, this.market);
    const vc = vcName(rng);
    c.lastRaiseWeek = this.week;
    const last = c.history[c.history.length - 1];
    if (last && runwayWeeks(c.cash, last.burn) > 120) {
      c.lastRaiseWeek = this.week - 4;
      this.emit('raise_rejected', c, 'deals', `🙅 ${vc} passed: "you have ${fmtTokens(c.cash)} in the bank — come back when you need it".`, 1, vc, 'investor', { stage: stage.name }, { key: 'ev.rejectedRich', params: { vc, cash: c.cash } });
      return;
    }
    if (rng() < score) {
      const amount = Math.round(range(rng, stage.amount[0], stage.amount[1]) * (0.6 + score * 0.6) * clamp(this.market.climate, 0.4, 1.6) / 10_000) * 10_000;
      let preMoney = Math.round(c.valuation * range(rng, 0.85, 1.15));
      preMoney = Math.max(preMoney, amount * 2.5);
      const total = totalShares(c.capTable);
      const shares = Math.round(total * (amount / preMoney));
      c.capTable.push({ name: `${vc} (${stage.name})`, kind: 'investor', shares });
      const pool = c.capTable.find((h) => h.kind === 'pool');
      if (pool) pool.shares += Math.round((total + shares) * 0.04);
      c.cash += amount;
      c.rounds.push({ name: stage.name, week: this.week, amount, preMoney, investor: vc });
      c.valuation = preMoney + amount;
      for (const e of active(c)) e.morale = clamp(e.morale + 0.08, 0, 1);
      this.emit('raise', c, 'deals', `💰 ${c.name} raised a ${fmtTokens(amount)} ${stage.name} led by ${vc} at a ${fmtTokens(preMoney)} pre-money valuation.`, 3, vc, 'investor', { amount, preMoney, stage: stage.name }, { key: 'ev.raise', params: { name: c.name, amount, stage: stage.name, vc, pre: preMoney } });
    } else {
      c.lastRaiseWeek = this.week - 6; // can try again in 4 weeks
      const why = pick(rng, REJECTIONS);
      this.emit('raise_rejected', c, 'deals', `🙅 ${vc} passed on the ${stage.name}: "${why}".`, 2, vc, 'investor', { stage: stage.name }, { key: 'ev.rejected', params: { vc, stage: stage.name, reason: why } });
    }
  }

  private people(c: Company): void {
    const rng = this.rngFor(c);
    const last = c.history[c.history.length - 1];
    const runway = last ? last.runwayWeeks : 99;
    const growth = weeklyGrowth(c, 4, 'customers');
    const base = 0.7 + (runway > 40 ? 0.08 : runway < 12 ? -0.22 : 0) + (growth > 0.03 ? 0.1 : growth < -0.01 ? -0.08 : 0);
    for (const e of active(c)) {
      e.morale = clamp(e.morale + (base - e.morale) * 0.1 + gauss(rng, 0.015), 0.05, 1);
    }
    // Low morale → resignations. Rivals with better valuations poach.
    for (const e of active(c)) {
      if (e.role === 'ceo') continue;
      const p = Math.max(0, 0.45 - e.morale) * 0.09;
      if (p > 0 && rng() < p) {
        const rivals = this.companies.filter((x) => x.id !== c.id && x.status !== 'bankrupt' && x.valuation > c.valuation * 1.3);
        const reason = rivals.length && rng() < 0.6 ? `joining ${pick(rng, rivals).name}, they pay in hope` : undefined;
        this.letGo(c, e, 'quit', undefined, reason);
      }
    }
    const avgMorale = active(c).reduce((s, e) => s + e.morale, 0) / Math.max(1, active(c).length);
    if (rng() < 0.28) {
      const line = chatter(c, rng, growth, runway, avgMorale);
      const speakers = active(c).filter((e) => e.role !== 'ceo');
      if (line && speakers.length) {
        const who = pick(rng, speakers);
        this.emit('chat', c, line.channel, line.text, 1, who.name, who.role);
      }
    }
  }

  private reviews(c: Company): void {
    const rng = this.rngFor(c);
    const staff = active(c).filter((e) => e.role !== 'ceo');
    if (!staff.length) return;
    for (const e of staff) {
      const expected = e.level === 3 ? 1.05 : e.level === 2 ? 0.85 : 0.62;
      const ratio = output(e, this.week) / expected;
      e.performance = clamp(0.55 * e.performance + 0.45 * (ratio + gauss(rng, 0.08)), 0, 1.6);
    }
    if (this.week % 12 !== 0) return;
    const sorted = [...staff].sort((a, b) => b.performance - a.performance);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const low = sorted.filter((e) => e.performance < 0.7).length;
    this.emit('review', c, 'hr', `📋 Performance reviews: ⭐ ${top.name} (${top.performance.toFixed(2)}) leads; ${bottom.name} is lowest (${bottom.performance.toFixed(2)}). ${low} on a performance plan.`, 1, 'People Ops', 'system', undefined, { key: 'ev.review', params: { top: top.name, topPerf: +top.performance.toFixed(2), bottom: bottom.name, bottomPerf: +bottom.performance.toFixed(2), low } });
  }

  private boardMeeting(c: Company): void {
    if (c.status === 'bankrupt') return;
    const rng = this.rngFor(c);
    const last = c.history[c.history.length - 1];
    const prevQ = c.history[c.history.length - 14];
    const qoq = prevQ && prevQ.revenue > 0 ? last.revenue / prevQ.revenue - 1 : 0;
    const runway = last.runwayWeeks;
    const moodKey = runway < 16 ? 'tense' : qoq > 0.3 ? 'thrilled' : qoq > 0.05 ? 'pleased' : 'flat';
    const mood = moodKey;
    const q = Math.ceil(this.week / 13);
    this.emit('board', c, 'board', `🏛️ Q${q} board meeting — ARR ${fmtTokens(last.revenue * 52)} (${qoq >= 0 ? '+' : ''}${Math.round(qoq * 100)}% QoQ), ${last.customers.toLocaleString('en-US')} customers, runway ${runway >= 999 ? '∞ (profitable)' : `${runway} wks`}. Board mood: ${mood}`, 2, 'The Board', 'board', undefined, { key: 'ev.board', params: { q, arr: last.revenue * 52, qoq: Math.round(qoq * 100), customers: last.customers, runway, mood: moodKey } });

    const outsiders = c.rounds.length > 1;
    if (!outsiders) return;
    if (runway < 20 && last.burn > 0) {
      // Forced burn cut: lay off the weakest until weekly costs drop ~25%.
      let toCut = last.burn * 0.25 + last.costs * 0.1;
      const victims = active(c).filter((e) => e.role !== 'ceo' && e.role !== 'cto').sort((a, b) => a.performance - b.performance);
      const names: string[] = [];
      for (const e of victims) {
        if (toCut <= 0 || active(c).length <= 3) break;
        e.status = 'fired';
        e.leftWeek = this.week;
        toCut -= e.salary + 350;
        names.push(e.name);
      }
      c.marketingBudget = Math.round(c.marketingBudget * 0.5);
      for (const e of active(c)) e.morale = clamp(e.morale - 0.12, 0, 1);
      if (names.length) {
        this.emit('board', c, 'board', `✂️ The board mandates a burn cut. ${names.length} people laid off (${names.slice(0, 4).join(', ')}${names.length > 4 ? '…' : ''}); marketing halved.`, 3, 'The Board', 'board', { laidOff: names.length }, { key: 'ev.burnCut', params: { count: names.length, names: names.slice(0, 4).join(', ') } });
      }
    }
    const peak = this.peakValuation.get(c.id) ?? c.valuation;
    if (this.week >= 39 && c.valuation < peak * 0.45 && rng() < 0.5) {
      const old = this.ceo(c);
      if (old) {
        old.status = 'fired';
        old.leftWeek = this.week;
        const fresh = this.makeEmployee(rng, `${c.id}-e${c.employees.length + 1}`, 'ceo', 3, this.week);
        c.employees.push(fresh);
        c.ceoName = fresh.name;
        this.peakValuation.set(c.id, c.valuation);
        this.emit('ceo_ousted', c, 'board', `🪓 Board ousts CEO ${old.name} after valuation fell ${Math.round((1 - c.valuation / peak) * 100)}% from peak. ${fresh.name} takes over (same ${c.brainLabel} brain, new face).`, 3, 'The Board', 'board', undefined, { key: 'ev.ceoOusted', params: { old: old.name, drop: Math.round((1 - c.valuation / peak) * 100), fresh: fresh.name, brain: c.brainLabel } });
      }
    }
  }

  private checkSurvival(c: Company): void {
    if (c.status === 'bankrupt' || c.cash >= 0) {
      if (c.cash >= 0) c.distress = 0;
      return;
    }
    const rng = this.rngFor(c);
    const score = investorScore(c, this.market);
    const last = c.history[c.history.length - 1];
    if (c.distress < 2 && score > 0.3 && rng() < 0.55 + score * 0.3) {
      c.distress += 1;
      const amount = Math.round((Math.max(0, -c.cash) + Math.max(last.burn, 10_000) * 10) / 10_000) * 10_000;
      const preMoney = Math.max(c.valuation * 0.45, amount * 1.5);
      const total = totalShares(c.capTable);
      const vc = vcName(rng);
      c.capTable.push({ name: `${vc} (Bridge)`, kind: 'investor', shares: Math.round(total * amount / preMoney) });
      c.rounds.push({ name: 'Bridge', week: this.week, amount, preMoney, investor: vc });
      c.cash += amount;
      c.valuation = preMoney + amount;
      this.emit('bridge', c, 'deals', `🩹 Out of cash — ${vc} wires a ${fmtTokens(amount)} emergency bridge at a brutal ${fmtTokens(preMoney)} valuation. Founders diluted.`, 3, vc, 'investor', undefined, { key: 'ev.bridge', params: { vc, amount, pre: preMoney } });
      return;
    }
    c.status = 'bankrupt';
    c.statusWeek = this.week;
    for (const e of active(c)) { e.status = 'fired'; e.leftWeek = this.week; }
    c.customers = 0;
    c.revenue = 0;
    c.valuation = 0;
    const s = c.history[c.history.length - 1];
    if (s) { s.headcount = 0; s.customers = 0; s.valuation = 0; }
    this.emit('bankrupt', c, 'general', `💀 ${c.name} has run out of money and shut down in week ${this.week}. "It was an incredible journey."`, 3, c.ceoName, 'ceo', undefined, { key: 'ev.bankrupt', params: { name: c.name, week: this.week } });
  }

  private updateValuation(c: Company): void {
    if (c.status === 'bankrupt') return;
    const target = targetValuation(c, this.market);
    c.valuation = c.valuation * 0.75 + target * 0.25;
    const s = c.history[c.history.length - 1];
    if (s) s.valuation = Math.round(c.valuation);
    if (c.valuation > (this.peakValuation.get(c.id) ?? 0)) this.peakValuation.set(c.id, c.valuation);
    if (c.status === 'operating' && c.valuation >= UNICORN) {
      c.status = 'unicorn';
      c.statusWeek = this.week;
      const first = !this.companies.some((x) => x.id !== c.id && x.status === 'unicorn');
      this.emit('unicorn', c, 'general', `🦄 ${c.name} is a UNICORN — valued at ${fmtTokens(c.valuation)} in week ${this.week}${first ? ', the first in the league' : ''}!`, 3, 'Market wire', 'market', undefined, { key: first ? 'ev.unicornFirst' : 'ev.unicorn', params: { name: c.name, valuation: c.valuation, week: this.week } });
    }
  }

  private milestoneCheck(c: Company): void {
    if (c.status === 'bankrupt') return;
    const seen = this.milestones.get(c.id)!;
    const N = (n: number) => ({ key: 'ev.milestoneCustomers', params: { name: c.name, n } });
    const A = (n: number) => ({ key: 'ev.milestoneArr', params: { name: c.name, amount: n } });
    const marks: [string, boolean, string, SimEvent['msg']?][] = [
      ['cust-100', c.customers >= 100, `🎯 ${c.name} hits 100 customers`, N(100)],
      ['cust-1k', c.customers >= 1_000, `🎯 ${c.name} hits 1,000 customers`, N(1_000)],
      ['cust-10k', c.customers >= 10_000, `🎯 ${c.name} hits 10,000 customers`, N(10_000)],
      ['cust-100k', c.customers >= 100_000, `🎯 ${c.name} hits 100,000 customers`, N(100_000)],
      ['cust-1m', c.customers >= 1_000_000, `🎯 ${c.name} hits 1,000,000 customers`, N(1_000_000)],
      ['arr-1m', c.revenue * 52 >= 1e6, `📈 ${c.name} crosses ${fmtTokens(1e6)} ARR`, A(1e6)],
      ['arr-10m', c.revenue * 52 >= 1e7, `📈 ${c.name} crosses ${fmtTokens(1e7)} ARR`, A(1e7)],
      ['arr-100m', c.revenue * 52 >= 1e8, `📈 ${c.name} crosses ${fmtTokens(1e8)} ARR`, A(1e8)],
      ['profit', c.history.length > 4 && c.history.slice(-4).every((h) => h.burn < 0), `💚 ${c.name} is profitable — default alive`, { key: 'ev.milestoneProfit', params: { name: c.name } }],
    ];
    for (const [key, hit, text, msg] of marks) {
      if (hit && !seen.has(key)) {
        seen.add(key);
        this.emit('milestone', c, 'general', text, 2, 'Market wire', 'market', undefined, msg);
      }
    }
  }

  private applyShocks(): void {
    while (this.shocks.length) {
      const { kind, companyId } = this.shocks.shift()!;
      const live = this.companies.filter((c) => c.status !== 'bankrupt');
      const target = (companyId && live.find((c) => c.id === companyId)) || (live.length ? pick(this.rng, live) : undefined);
      switch (kind) {
        case 'funding-freeze':
          this.market.climate = clamp(this.market.climate * 0.5, 0.25, 1.9);
          this.emit('shock', undefined, 'market', '🥶 SHOCK: funding freeze — investors stop writing checks overnight.', 3, 'Market wire', 'market', undefined, { key: 'ev.shockFreeze' });
          break;
        case 'mania':
          this.market.climate = clamp(this.market.climate * 1.5, 0.25, 1.9);
          this.emit('shock', undefined, 'market', '🚀 SHOCK: VC mania — term sheets are flying.', 3, 'Market wire', 'market', undefined, { key: 'ev.shockMania' });
          break;
        case 'recession':
          for (const s of SEGMENT_LIST) this.market.demand[s] = clamp(this.market.demand[s] * 0.8, 0.4, 1.8);
          this.market.churnMult = clamp(this.market.churnMult * 1.3, 0.6, 2);
          this.emit('shock', undefined, 'market', '📉 SHOCK: recession — customers cut budgets, churn spikes.', 3, 'Market wire', 'market', undefined, { key: 'ev.shockRecession' });
          break;
        case 'viral':
          if (target) {
            target.product.brand = clamp(target.product.brand + 30, 0, 100);
            const seg = SEGMENTS[target.product.segment];
            target.customers += Math.round(seg.tam * 0.01 * (0.5 + target.product.quality / 100));
            this.emit('shock', target, 'general', `🔥 ${target.name} goes viral! A celebrity posted about it; signups explode.`, 3, 'Market wire', 'market', undefined, { key: 'ev.shockViral', params: { name: target.name } });
          }
          break;
        case 'outage':
          if (target) {
            target.product.quality = clamp(target.product.quality - 15, 1, 100);
            target.customers = Math.round(target.customers * 0.9);
            this.emit('shock', target, 'eng', `💥 ${target.name} suffers a 14-hour outage. Customers are furious; 10% leave.`, 3, 'Status page', 'system', undefined, { key: 'ev.shockOutage', params: { name: target.name } });
          }
          break;
        case 'poach':
          if (target) {
            const best = active(target).filter((e) => e.role === 'engineer' || e.role === 'cto').sort((a, b) => b.skill - a.skill)[0];
            if (best) this.letGo(target, best, 'quit', undefined, 'got an offer I could not refuse');
          }
          break;
      }
    }
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private grantOptions(c: Company, shares: number): void {
    const pool = c.capTable.find((h) => h.kind === 'pool');
    if (!pool) return;
    if (pool.shares < shares * 3) pool.shares += Math.round(totalShares(c.capTable) * 0.02); // pool top-up dilutes everyone
  }

  private ceo(c: Company): Employee | undefined {
    return c.employees.find((e) => e.role === 'ceo' && e.status === 'active');
  }

  private rngFor(c: Company): Rng {
    return this.crng[this.companies.indexOf(c)];
  }

  private emit(kind: EventKind, c: Company | undefined, channel: Channel, text: string, importance: 1 | 2 | 3,
    author?: string, authorRole?: SimEvent['authorRole'], data?: Record<string, unknown>, msg?: SimEvent['msg']): void {
    const ev: SimEvent = { id: this.nextEventId++, week: this.week, companyId: c?.id, kind, channel, text: stripEmoji(text), importance };
    if (msg) ev.msg = msg;
    if (author) ev.author = author;
    if (authorRole) ev.authorRole = authorRole;
    if (data) ev.data = data;
    this.events.push(ev);
    this.pendingEvents.push(ev);
  }

  private captureFrame(): void {
    const frame: Frame = {
      week: this.week,
      market: { ...this.market, demand: { ...this.market.demand } },
      companies: this.companies.map((c) => snapshot(c, this.week)),
    };
    this.frames.push(frame);
  }
}

function snapshot(c: Company, week: number): CompanySnapshot {
  const stat = c.history[c.history.length - 1] ?? {
    week, cash: Math.round(c.cash), revenue: 0, costs: 0, payroll: weeklyCosts(c).payroll, marketing: c.marketingBudget,
    infra: 0, bounties: 0, aiSpend: 0, burn: 0, customers: 0, newCustomers: 0, churned: 0, headcount: active(c).length,
    quality: c.product.quality, valuation: Math.round(c.valuation), runwayWeeks: 999,
  };
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    cash: Math.round(c.cash),
    revenue: Math.round(c.revenue * 100) / 100,
    customers: c.customers,
    valuation: Math.round(c.valuation),
    focus: c.focus,
    marketingBudget: Math.round(c.marketingBudget),
    product: { ...c.product, quality: round2(c.product.quality), techDebt: round2(c.product.techDebt), brand: round2(c.product.brand), features: round2(c.product.features) },
    employees: c.employees
      .filter((e) => e.status === 'active' || (e.leftWeek !== undefined && week - e.leftWeek <= 6))
      .map((e) => ({
        id: e.id, name: e.name, role: e.role, level: e.level, salary: e.salary, performance: round2(e.performance),
        morale: round2(e.morale), status: e.status, hiredWeek: e.hiredWeek, leftWeek: e.leftWeek, tasksDone: e.tasksDone, earned: e.earned,
      })),
    capTable: c.capTable.map((h) => ({ ...h })),
    rounds: c.rounds.map((r) => ({ ...r })),
    stat: { ...stat },
    memo: c.lastMemo,
    llmTokens: c.llmTokens,
  };
}

/** Clamp anything a brain says into something the world can execute. Brains can be wrong, never dangerous. */
export function sanitize(d: Partial<Decision> | undefined, c: Company): Decision {
  const seg = SEGMENTS[c.product.segment];
  const focus = FOCUSES.includes(d?.focus as never) ? (d!.focus as Decision['focus']) : c.focus;
  const hire = Array.isArray(d?.hire) ? d!.hire.filter((r): r is Role => HIREABLE_ROLES.includes(r as Role)).slice(0, MAX_HIRES_PER_WEEK) : [];
  const activeIds = new Set(active(c).filter((e) => e.role !== 'ceo').map((e) => e.id));
  const fire = Array.isArray(d?.fire) ? [...new Set(d!.fire.filter((id) => typeof id === 'string' && activeIds.has(id)))] : [];
  let price: number | undefined;
  if (typeof d?.price === 'number' && Number.isFinite(d.price) && d.price > 0) price = clamp(d.price, seg.wtp * 0.25, seg.wtp * 4);
  let marketingBudget: number | undefined;
  if (typeof d?.marketingBudget === 'number' && Number.isFinite(d.marketingBudget)) {
    marketingBudget = Math.round(clamp(d.marketingBudget, 0, Math.max(0, c.cash) / 6));
  }
  const pivot = SEGMENT_LIST.includes(d?.pivot as Segment) ? (d!.pivot as Segment) : undefined;
  const memo = typeof d?.memo === 'string' ? d.memo.replace(/\s+/g, ' ').trim().slice(0, 280) : '';
  return { focus, hire, fire, price, marketingBudget, pivot, raise: d?.raise === true, memo };
}

function headroom(q: number): number { return Math.pow(Math.max(0, 1 - q / 100), 1.5); }
/** Event text is plain prose: strip pictographic emoji so terminals and the UI stay clean. */
export function stripEmoji(s: string): string {
  return s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu, '').replace(/\s{2,}/g, ' ').trim();
}
function round2(x: number): number { return Math.round(x * 100) / 100; }
function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function fmtPrice(p: number): string { return p >= 100 ? fmtTokens(p) : `◈${p.toFixed(2)}`; }
