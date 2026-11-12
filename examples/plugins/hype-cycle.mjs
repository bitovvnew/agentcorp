// A custom market scenario: the Gartner-style hype cycle.
// Run it:  npx agentcorp league --plugin examples/plugins/hype-cycle.mjs --scenario hype-cycle

/** @type {import('agentcorp').Scenario} */
export default {
  kind: 'scenario',
  id: 'hype-cycle',
  name: 'Hype cycle',
  description: 'Peak of inflated expectations at week 20, trough of disillusionment at week 45, then a slow plateau.',
  onWeek(ctx) {
    const w = ctx.week;
    const m = ctx.market;
    // Investor climate follows a hype curve: up fast, crash, recover slowly.
    const target = w < 20 ? 1 + w * 0.04 : w < 45 ? 1.8 - (w - 20) * 0.05 : Math.min(1.1, 0.55 + (w - 45) * 0.01);
    m.climate += (target - m.climate) * 0.25;
    for (const s of Object.keys(m.demand)) m.demand[s] += ((w < 30 ? 1.2 : 0.9) - m.demand[s]) * 0.05;

    if (w === 20) ctx.headline('🎢 Peak of inflated expectations: every startup is now "agentic"', 3);
    if (w === 45) ctx.headline('🕳️ Trough of disillusionment: "Agents don\'t actually work," says everyone who said they did', 3);
    if (w === 70) ctx.headline('🧘 Plateau of productivity: boring companies with real revenue are back in fashion', 2);
  },
};
