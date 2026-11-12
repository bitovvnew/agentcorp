import type { CompanyTemplate } from '../types.js';

export const saas: CompanyTemplate = {
  kind: 'template',
  id: 'saas',
  name: 'B2B SaaS',
  description: 'Workflow software for small businesses. Classic land-and-expand: marketing-led, moderate churn.',
  segment: 'smb',
  cash: 750_000,
  team: [
    { role: 'ceo', level: 2 },
    { role: 'cto', level: 2 },
    { role: 'engineer', level: 2 },
    { role: 'engineer', level: 1 },
    { role: 'marketer', level: 2 },
  ],
  product: { quality: 34, features: 3, techDebt: 12, brand: 8, price: 55 },
  marketingBudget: 3_000,
  names: ['Ledgerly', 'Shiftwise', 'Invoicr', 'Crewbase', 'Tidyflow', 'Quillstack', 'Bookwise', 'Formcraft', 'Rosterly', 'Payloop'],
  taglines: ['Back office on autopilot', 'Scheduling that runs itself', 'Invoices that chase themselves', 'The ops OS for small teams'],
};

export const enterprise: CompanyTemplate = {
  kind: 'template',
  id: 'enterprise',
  name: 'Enterprise platform',
  description: 'Big contracts, long sales cycles, low churn. Lives or dies by its sales team.',
  segment: 'enterprise',
  cash: 1_300_000,
  team: [
    { role: 'ceo', level: 3 },
    { role: 'cto', level: 2 },
    { role: 'engineer', level: 2 },
    { role: 'engineer', level: 2 },
    { role: 'sales', level: 2 },
  ],
  product: { quality: 30, features: 4, techDebt: 10, brand: 5, price: 2_400 },
  marketingBudget: 1_500,
  names: ['Gridforge', 'Vaultline', 'Compliancy', 'Sentrix', 'Dataharbor', 'Auditly', 'Bastion AI'],
  taglines: ['Compliance without the binders', 'Your data, finally governed', 'Security reviews in minutes'],
};

export const consumer: CompanyTemplate = {
  kind: 'template',
  id: 'consumer',
  name: 'Consumer app',
  description: 'Cheap subscriptions, millions of potential users, brutal churn. Virality is everything.',
  segment: 'consumer',
  cash: 650_000,
  team: [
    { role: 'ceo', level: 2 },
    { role: 'cto', level: 2 },
    { role: 'engineer', level: 2 },
    { role: 'designer', level: 2 },
    { role: 'marketer', level: 1 },
  ],
  product: { quality: 32, features: 3, techDebt: 8, brand: 10, price: 2.2 },
  marketingBudget: 4_000,
  names: ['Snackable', 'Moodboard', 'Pocketcoach', 'Dreamjournal', 'Fitfable', 'Nookreads', 'Petpal'],
  taglines: ['Your pocket life coach', 'Bedtime stories, remixed', 'Habits that stick'],
};

export const devtools: CompanyTemplate = {
  kind: 'template',
  id: 'devtools',
  name: 'Developer tools',
  description: 'Bottom-up adoption by engineers. Quality drives word of mouth; marketing barely works.',
  segment: 'developer',
  cash: 850_000,
  team: [
    { role: 'ceo', level: 2 },
    { role: 'cto', level: 3 },
    { role: 'engineer', level: 2 },
    { role: 'engineer', level: 2 },
    { role: 'engineer', level: 1 },
  ],
  product: { quality: 38, features: 4, techDebt: 10, brand: 6, price: 20 },
  marketingBudget: 1_000,
  names: ['Stacktrace', 'Diffly', 'Buildkite Jr', 'Lintwise', 'Deployd', 'Tracehound', 'Cachet'],
  taglines: ['CI that never flakes', 'Debugging at the speed of thought', 'Ship on Fridays again'],
};

export const aiWrapper: CompanyTemplate = {
  kind: 'template',
  id: 'ai-wrapper',
  name: 'AI wrapper',
  description: 'Two people, a prompt and a dream. Tiny runway, huge upside, zero moat.',
  segment: 'consumer',
  cash: 360_000,
  team: [
    { role: 'ceo', level: 2 },
    { role: 'engineer', level: 2 },
  ],
  product: { quality: 26, features: 2, techDebt: 25, brand: 14, price: 2.6 },
  marketingBudget: 2_500,
  names: ['PromptPal', 'ChatYourDocs', 'Wrapr', 'GPTea', 'AutoAnything', 'Thinkr'],
  taglines: ['It is just a prompt (but a great one)', 'Chat with literally anything', 'AI for your AI'],
};

export const TEMPLATES: CompanyTemplate[] = [saas, enterprise, consumer, devtools, aiWrapper];
