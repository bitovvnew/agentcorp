// Flavor text: the Slack-like chatter that makes a simulation feel like a company.
import { pick, type Rng } from './rng.js';
import type { Company, Focus, Role } from './types.js';

export const BOUNTIES: Record<Focus, { role: Role; title: string[] }[]> = {
  build: [
    { role: 'engineer', title: ['Ship SSO', 'Build the public API', 'Launch mobile app v1', 'Add team workspaces', 'Ship dark mode', 'Build Zapier integration', 'Offline sync', 'AI autocomplete'] },
    { role: 'designer', title: ['Redesign onboarding', 'New pricing page', 'Design system v2'] },
  ],
  quality: [
    { role: 'engineer', title: ['Kill the flaky test suite', 'Rewrite the billing service', 'Cut p95 latency in half', 'Migrate off the legacy DB', 'Fix the memory leak', 'Pay down auth tech debt'] },
    { role: 'designer', title: ['Fix the 30 worst UX papercuts', 'Accessibility pass'] },
    { role: 'support', title: ['Clear the ticket backlog', 'Write the help center'] },
  ],
  growth: [
    { role: 'marketer', title: ['Launch on Product Hunt', 'SEO content sprint', 'Referral program', 'Viral launch video', 'Conference sponsorship', 'Influencer campaign'] },
    { role: 'designer', title: ['Landing page A/B test'] },
  ],
  sales: [
    { role: 'sales', title: ['Close the logistics pilot', 'Outbound blitz', 'Partner channel deal', 'Upsell the top 20 accounts', 'Land a Fortune 500 logo'] },
    { role: 'marketer', title: ['Case-study webinar'] },
  ],
  efficiency: [
    { role: 'cfo', title: ['Renegotiate cloud contract', 'Kill unused SaaS seats', 'Annual-prepay campaign'] },
    { role: 'engineer', title: ['Cut infra costs 30%', 'Automate deploys'] },
    { role: 'support', title: ['Self-serve help bot'] },
  ],
};

export const FOCUS_LABEL: Record<Focus, string> = {
  build: 'shipping features',
  quality: 'quality & tech debt',
  growth: 'growth marketing',
  sales: 'sales',
  efficiency: 'efficiency',
};

const CHATTER = {
  debt: ['the build takes 40 minutes now. just saying.', 'who wrote this auth module? …oh. me.', 'every bug fix creates two new bugs 🐛🐛', 'can we please schedule a refactor week'],
  broke: ['is it just me or did the snack budget shrink?', 'updating my LinkedIn. for… reasons.', 'payroll went out, right? right??', 'why is the CFO googling "bridge loan"'],
  growing: ['🎉 another record week!', 'servers are on fire (the good kind)', 'signups chart looks like a hockey stick 🏒', 'we need more support people, the inbox is exploding'],
  quality: ['customers are sending us *thank you* emails???', 'NPS just hit an all-time high 💚', 'a customer called us "the only software that works"'],
  sales: ['closed a deal with a dentist chain 🦷', 'procurement wants a 47-page security questionnaire', 'demo went great, they want a pilot 🙏'],
  morale: ['anyone else working weekends again?', 'I miss when we were 5 people', 'that all-hands was… a lot'],
  neutral: ['standup moved to 10:15', 'who took my monitor', 'lunch & learn on Thursday: "Vibes-based estimation"', 'reminder: expense reports due friday', 'new coffee machine 🔥'],
};

export function chatter(c: Company, rng: Rng, growth: number, runway: number, morale: number): { text: string; channel: 'eng' | 'general' | 'sales' } | null {
  const options: { text: string; channel: 'eng' | 'general' | 'sales' }[] = [];
  if (c.product.techDebt > 55) options.push({ text: pick(rng, CHATTER.debt), channel: 'eng' });
  if (runway < 16) options.push({ text: pick(rng, CHATTER.broke), channel: 'general' });
  if (growth > 0.04) options.push({ text: pick(rng, CHATTER.growing), channel: 'general' });
  if (c.product.quality > 75) options.push({ text: pick(rng, CHATTER.quality), channel: 'general' });
  if (c.focus === 'sales') options.push({ text: pick(rng, CHATTER.sales), channel: 'sales' });
  if (morale < 0.55) options.push({ text: pick(rng, CHATTER.morale), channel: 'general' });
  options.push({ text: pick(rng, CHATTER.neutral), channel: 'general' });
  return options.length ? pick(rng, options) : null;
}

export const QUIT_REASONS = [
  'to start my own company', 'to take a sabbatical in Lisbon', 'to join big tech for the stock', 'burnout. need a break',
  'my visa situation changed', 'to go back to school', 'to become a pottery teacher',
];

export const REJECTIONS = [
  'we love the team but the growth is not there yet',
  'come back when you have 3 months of 5%+ week-over-week growth',
  'not a fit for our current fund thesis',
  'the market feels too small',
  'we are pausing new investments this quarter',
  'we had concerns about churn',
];

export const MEMOS: Record<Focus, string[]> = {
  build: ['Heads down, ship ship ship. The roadmap is the strategy.', 'This sprint is all about features customers keep asking for.', 'We win by out-building everyone. Let\'s go.'],
  quality: ['We are pausing new features. Quality is the feature now.', 'Tech debt is a loan with a brutal interest rate. Paying it down.', 'Customers are leaving because things break. Fix the basics.'],
  growth: ['Product is good enough — time to tell the world.', 'Every week we don\'t market is a week a competitor does.', 'Doubling down on distribution.'],
  sales: ['Revenue cures all. Everyone is in sales this month.', 'Let\'s close the pipeline before the quarter ends.', 'Big logos, big contracts.'],
  efficiency: ['Default alive or default dead? We choose alive. Cutting burn.', 'Every token counts. Reviewing every line item.', 'Runway is oxygen. We are conserving it.'],
};
