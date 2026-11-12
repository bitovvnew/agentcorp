// Core domain types for AgentCorp. Money is denominated in tokens (◈).

export type Role = 'ceo' | 'cto' | 'engineer' | 'designer' | 'marketer' | 'sales' | 'cfo' | 'support';
export const ROLES: Role[] = ['ceo', 'cto', 'engineer', 'designer', 'marketer', 'sales', 'cfo', 'support'];
export const HIREABLE_ROLES: Role[] = ['cto', 'engineer', 'designer', 'marketer', 'sales', 'cfo', 'support'];

export type Segment = 'smb' | 'enterprise' | 'consumer' | 'developer';
export const SEGMENTS: Segment[] = ['smb', 'enterprise', 'consumer', 'developer'];

/** What the company concentrates on this week. Drives the internal task marketplace. */
export type Focus = 'build' | 'growth' | 'sales' | 'quality' | 'efficiency';
export const FOCUSES: Focus[] = ['build', 'growth', 'sales', 'quality', 'efficiency'];

export type CompanyStatus = 'operating' | 'unicorn' | 'bankrupt';

export type Channel = 'general' | 'eng' | 'sales' | 'board' | 'hr' | 'market' | 'deals';

export interface Employee {
  id: string;
  name: string;
  role: Role;
  level: 1 | 2 | 3;
  /** Weekly salary in tokens. */
  salary: number;
  /** Hidden true ability, 0..1. */
  skill: number;
  /** 0..1. Low morale lowers output and raises quit risk. */
  morale: number;
  /** Rolling performance score, 0..1.5 (1 = meets expectations). */
  performance: number;
  hiredWeek: number;
  leftWeek?: number;
  status: 'active' | 'fired' | 'quit';
  tasksDone: number;
  /** Bounties earned on the internal task marketplace. */
  earned: number;
  /** Equity grant (shares from the option pool). */
  shares: number;
}

export interface Product {
  name: string;
  segment: Segment;
  /** 0..100 */
  quality: number;
  features: number;
  /** 0..100. Slows engineering and raises churn. */
  techDebt: number;
  /** 0..100 */
  brand: number;
  /** Weekly price per customer, in tokens. */
  price: number;
}

export interface Shareholder {
  name: string;
  kind: 'founder' | 'investor' | 'pool';
  shares: number;
}

export interface FundingRound {
  name: string;
  week: number;
  amount: number;
  preMoney: number;
  investor: string;
}

export interface WeekStat {
  week: number;
  cash: number;
  revenue: number;
  costs: number;
  payroll: number;
  marketing: number;
  infra: number;
  bounties: number;
  aiSpend: number;
  burn: number;
  customers: number;
  newCustomers: number;
  churned: number;
  headcount: number;
  quality: number;
  valuation: number;
  runwayWeeks: number;
}

export interface Company {
  id: string;
  name: string;
  tagline: string;
  color: number; // categorical slot index
  template: string;
  brainId: string;
  brainLabel: string;
  ceoName: string;
  cash: number;
  employees: Employee[];
  product: Product;
  customers: number;
  /** Fractional customers carried between weeks so growth is smooth. */
  customerFrac: number;
  revenue: number;
  marketingBudget: number;
  focus: Focus;
  capTable: Shareholder[];
  rounds: FundingRound[];
  valuation: number;
  status: CompanyStatus;
  statusWeek?: number;
  history: WeekStat[];
  lastRaiseWeek: number;
  pivots: number;
  /** Total LLM tokens spent by this company's brain. */
  llmTokens: number;
  /** Consecutive weeks with negative cash covered by bridge financing. */
  distress: number;
  lastDecision?: Decision;
  lastMemo?: string;
}

export interface Market {
  week: number;
  /** Investor sentiment, ~0.3 (nuclear winter) .. ~1.8 (mania). 1 = normal. */
  climate: number;
  /** Demand multiplier per segment. 1 = normal. */
  demand: Record<Segment, number>;
  /** Churn multiplier (recessions raise it). */
  churnMult: number;
  headline?: string;
}

export interface SimEvent {
  id: number;
  week: number;
  companyId?: string;
  kind: EventKind;
  channel: Channel;
  author?: string;
  authorRole?: Role | 'board' | 'investor' | 'market' | 'system';
  text: string;
  importance: 1 | 2 | 3;
  data?: Record<string, unknown>;
  /** Translatable form of `text`: an i18n key plus parameters (money as raw numbers). */
  msg?: { key: string; params?: Record<string, string | number | boolean> };
}

export type EventKind =
  | 'founded' | 'memo' | 'hire' | 'fire' | 'quit' | 'review' | 'bounty'
  | 'ship' | 'pivot' | 'price' | 'raise' | 'raise_rejected' | 'bridge'
  | 'board' | 'ceo_ousted' | 'bankrupt' | 'unicorn' | 'milestone'
  | 'market' | 'shock' | 'chat' | 'brain_error' | 'focus' | 'budget';

/** What a brain (the CEO's mind) decides for the coming period. */
export interface Decision {
  focus: Focus;
  hire: Role[];
  /** Employee ids to let go. */
  fire: string[];
  /** New weekly price per customer (optional). */
  price?: number;
  /** Weekly marketing spend (optional). */
  marketingBudget?: number;
  pivot?: Segment;
  raise?: boolean;
  /** A short message to the team — shows up in #general. */
  memo: string;
}

export interface EmployeeView {
  id: string;
  name: string;
  role: Role;
  level: number;
  salary: number;
  performance: number;
  morale: number;
  tenureWeeks: number;
}

export interface Observation {
  week: number;
  weeksLeft: number;
  goal: string;
  company: {
    name: string;
    segment: Segment;
    focus: Focus;
    pivots: number;
    cash: number;
    weeklyRevenue: number;
    weeklyBurn: number;
    runwayWeeks: number;
    customers: number;
    customerGrowth8w: number;
    revenueGrowth8w: number;
    churnRate: number;
    price: number;
    marketingBudget: number;
    quality: number;
    techDebt: number;
    brand: number;
    features: number;
    valuation: number;
    founderOwnership: number;
    rounds: number;
    weeksSinceRaise: number;
    status: CompanyStatus;
  };
  team: EmployeeView[];
  headcountByRole: Partial<Record<Role, number>>;
  market: {
    climate: number;
    demand: number;
    saturation: number;
    segmentPrice: number;
    headline?: string;
  };
  competitors: { name: string; segment: Segment; valuation: number; customers: number; quality: number; status: CompanyStatus }[];
  recent: string[];
  salaryGuide: Record<Role, number>;
}

export interface BrainUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface BrainResult {
  decision: Decision;
  usage?: BrainUsage;
  error?: string;
}

export interface BrainContext {
  /** Deterministic random source for this company (heuristic brains use it). */
  random: () => number;
}

export interface Brain {
  readonly id: string;
  readonly label: string;
  readonly kind: 'heuristic' | 'llm';
  decide(obs: Observation, ctx: BrainContext): Promise<BrainResult>;
}

export interface CompanySpec {
  name?: string;
  template: string;
  brain: string;
}

export interface SimConfig {
  seed: number;
  weeks: number;
  scenario: string;
  companies: CompanySpec[];
  /** LLM brains decide every N weeks (heuristic brains decide weekly). */
  decideEvery?: number;
  /** Tokens of company money charged per real LLM token spent (0 = off). */
  tokenCharge?: number;
  /** Hard spend caps for LLM CEOs (tokens). When hit, the company runs on autopilot. */
  budget?: { perAgentTokens?: number; totalTokens?: number };
  title?: string;
}

/** Compact per-company state captured once per week for live view and replays. */
export interface CompanySnapshot {
  id: string;
  name: string;
  status: CompanyStatus;
  cash: number;
  revenue: number;
  customers: number;
  valuation: number;
  focus: Focus;
  marketingBudget: number;
  product: Product;
  employees: Pick<Employee, 'id' | 'name' | 'role' | 'level' | 'salary' | 'performance' | 'morale' | 'status' | 'hiredWeek' | 'leftWeek' | 'tasksDone' | 'earned'>[];
  capTable: Shareholder[];
  rounds: FundingRound[];
  stat: WeekStat;
  memo?: string;
  llmTokens: number;
}

export interface Frame {
  week: number;
  market: Market;
  companies: CompanySnapshot[];
}

export interface CompanyMeta {
  id: string;
  name: string;
  tagline: string;
  color: number;
  template: string;
  brainId: string;
  brainLabel: string;
  ceoName: string;
}

export interface LeagueRow {
  rank: number;
  id: string;
  name: string;
  brainLabel: string;
  status: CompanyStatus;
  valuation: number;
  arr: number;
  customers: number;
  headcount: number;
  cash: number;
  founderStake: number;
  score: number;
}

export interface Replay {
  format: 'agentcorp-replay';
  version: 1;
  generator: string;
  config: SimConfig;
  scenario: { id: string; name: string; description: string };
  companies: CompanyMeta[];
  frames: Frame[];
  events: SimEvent[];
  league?: LeagueRow[];
  finished: boolean;
}
