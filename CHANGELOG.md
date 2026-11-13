# Changelog

## 0.1.2 — 2026-11-12

- Added complete Simplified Chinese, Korean, Spanish and Japanese translations for browser and terminal setup, dashboard and built-in simulation events.
- The default first launch opens the browser setup. The explicit `demo` command runs the same keyless league as before.
- Added `setup.bat` and `setup.sh` launchers for provider onboarding from a checkout.
- Browser setup validates keys when pasted and keeps the newly discovered model selection.
- Free league: a Free setup button in the browser and `agentcorp setup --free` in the terminal pick only no-cost models (local Ollama, Groq and Gemini free tiers, OpenRouter zero-price models), spread across providers.
- Groq provider (`groq:<model>`, `GROQ_API_KEY`), with models listed from its API.
- Free models are marked in every model picker; OpenRouter pricing is read from its catalog.
- README translations in `docs/i18n/` for all eight languages.

## 0.1.1 — 2026-11-12

- A redesigned dashboard with a replay scrubber, market wire, quarterly board decks, investor pitches and downloadable season recaps.
- Browser and terminal setup with live key checks, provider model discovery and detection of models installed in Ollama.
- Multi-race championships with scenario and seed sweeps, a points table and a standalone HTML report.
- English, Russian, Kazakh and French dashboard and setup translations, with message and placeholder coverage checked in CI.
- OpenRouter support, local league configuration, token usage thresholds and credential redaction for provider errors.
- Keyless demo on the default first launch, with smoke tests for replay, pitch and championship export.

## 0.1.0 — 2026-11-12

First public release.

- Simulation engine: weekly ticks, payroll, burn, runway, shared multi-company market with saturation and competitive churn.
- People: hiring with hidden skill and ramp-up, firing with severance, morale, resignations and poaching, performance reviews.
- Internal task marketplace: CEO posts bounties, employees bid, the best value wins.
- Funding from Seed to Series E and growth rounds, bridges, dilution and a live cap table; board meetings that force layoffs or oust the CEO.
- Pivots across four segments: SMB SaaS, enterprise, consumer, dev tools.
- Four built-in CEO personalities (no API key): Steady Operator, Blitzscaler, Bootstrapper, Visionary.
- LLM CEOs: Anthropic (official SDK, structured outputs), OpenAI, Gemini, Ollama and any OpenAI-compatible API, with retries, decision sanitizing and autopilot fallback.
- League mode, five scenarios, five templates, plugin loader for custom scenarios and templates.
- Live dashboard over SSE: league table, valuation race, KPIs, cash and funding, P&L, customers, spend, cap table, org chart, company Slack, decision timeline, bounties, shocks.
- Deterministic replays, replay viewer, single-file HTML export.
