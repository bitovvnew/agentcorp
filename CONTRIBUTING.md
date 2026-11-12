# Contributing to AgentCorp

Thanks for helping! Good first contributions:

- **Scenarios** (`src/plugins/scenarios/`): new market histories such as a rate-hike cycle or a regulation shock.
- **Templates** (`src/plugins/templates/`): new kinds of companies.
- **Brain adapters** (`src/brains/llm.ts`): more providers, better prompts.
- **Dashboard views** (`web/app.js`): plain JS and SVG, no build step.
- **Economy tuning** (`src/economy.ts`): if a formula looks wrong, open an issue with a seed that shows the problem.

## Setup

```bash
npm install
npm test          # vitest
npm run typecheck
npm start         # build + live demo
```

## Rules of the road

- Keep the engine deterministic. Use the seeded RNG streams, never `Math.random()`, in `src/`.
- Keep runtime dependencies at zero (optional provider SDKs are the only exception).
- Every economic change needs a test, and the demo league should still be a contest. Check with `node bin/agentcorp.js league --headless` over a few seeds.
- Screenshots come from demo data only (`npm run screenshots`). Never commit real API keys, personal paths or real names.
- Brains must never see hidden state, such as an employee's skill.
