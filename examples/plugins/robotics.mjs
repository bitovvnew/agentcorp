// A custom company template: an expensive, slow, enterprise-heavy robotics startup.
// Run it:  npx agentcorp league --plugin examples/plugins/robotics.mjs --template robotics

/** @type {import('agentcorp').CompanyTemplate} */
export default {
  kind: 'template',
  id: 'robotics',
  name: 'Warehouse robotics',
  description: 'Hardware is hard: huge starting round, senior team, few but very large customers.',
  segment: 'enterprise',
  cash: 4_000_000,
  team: [
    { role: 'ceo', level: 3 },
    { role: 'cto', level: 3 },
    { role: 'engineer', level: 3 },
    { role: 'engineer', level: 2 },
    { role: 'engineer', level: 2 },
    { role: 'sales', level: 3 },
  ],
  product: { quality: 22, features: 2, techDebt: 15, brand: 4, price: 3_200 },
  marketingBudget: 2_000,
  names: ['Forklift.ai', 'Pallet Labs', 'Gripworks', 'Aisle Nine Robotics'],
  taglines: ['Robots that pick, pack and never call in sick', 'Your warehouse, on autopilot'],
};
