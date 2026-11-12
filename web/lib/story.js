// Narrative generators built from a replay: investor pitch, obituary / success story, board meeting deck.
// Pure functions of (replay, company, frame index, translator). Shared by the dashboard and `agentcorp pitch`.

const snap = (replay, id, idx) => replay.frames[idx].companies.find((c) => c.id === id);
const metaOf = (replay, id) => replay.companies.find((c) => c.id === id);
const activeOf = (s) => s.employees.filter((e) => e.status === 'active');

function history(replay, id, idx) {
  const out = [];
  for (let i = 1; i <= idx; i++) {
    const s = snap(replay, id, i);
    if (s && s.stat.week === replay.frames[i].week) out.push(s);
  }
  return out;
}

function growth(h, n, field) {
  if (h.length < 2) return 0;
  const a = h[Math.max(0, h.length - 1 - n)], b = h[h.length - 1];
  const va = field === 'customers' ? a.customers : a.stat.revenue;
  const vb = field === 'customers' ? b.customers : b.stat.revenue;
  const span = Math.min(n, h.length - 1);
  if (va <= 0 || vb <= 0) return 0;
  return Math.pow(vb / va, 1 / span) - 1;
}

function founders(s) {
  const total = s.capTable.reduce((a, h) => a + h.shares, 0) || 1;
  return s.capTable.filter((h) => h.kind === 'founder').reduce((a, h) => a + h.shares, 0) / total;
}

const STAGES = ['Seed', 'Series A', 'Series B', 'Series C', 'Series D', 'Series E', 'Growth round'];

/* ───────────────────────── pitch deck ───────────────────────── */
export function buildPitch(replay, id, idx, t) {
  const s = snap(replay, id, idx);
  const m = metaOf(replay, id);
  const h = history(replay, id, idx);
  const seg = s.product.segment;
  const st = s.stat;
  const team = activeOf(s);
  const byRole = {};
  for (const e of team) byRole[e.role] = (byRole[e.role] || 0) + 1;
  const priced = s.rounds.filter((r) => r.name !== 'Pre-seed' && r.name !== 'Bridge').length;
  const stage = STAGES[Math.min(priced, STAGES.length - 1)];
  const burn = Math.max(0, st.burn);
  const ask = Math.max(1_500_000, Math.round((burn * 78 + st.revenue * 20) / 100_000) * 100_000);
  const g = growth(h, 8, 'revenue');
  const margin = st.revenue > 0 ? Math.max(0, (st.revenue - st.infra) / st.revenue) : 0;
  const cac = st.newCustomers > 0 ? st.marketing / st.newCustomers : 0;
  const rivals = replay.frames[idx].companies.filter((c) => c.id !== id && c.status !== 'bankrupt');
  const leagueCustomers = replay.frames[idx].companies.filter((c) => c.product.segment === seg).reduce((a, c) => a + c.customers, 0) || 1;
  const spend = [['payroll', st.payroll], ['marketing', st.marketing], ['infra', st.infra], ['bounties', st.bounties]].filter(([, v]) => v > 0);
  const spendTotal = spend.reduce((a, [, v]) => a + v, 0) || 1;
  const top = [...team].filter((e) => e.role !== 'ceo').sort((a, b) => b.performance - a.performance)[0];

  return {
    title: t('pitch.title', { name: s.name }),
    slides: [
      { title: s.name, kicker: t('pitch.cover.kicker', { stage, week: st.week }), lines: [m.tagline, t('pitch.cover.ask', { amount: ask, stage })] },
      { title: t('pitch.problem'), lines: [t(`pitch.problem.${seg}`)] },
      { title: t('pitch.solution'), lines: [m.tagline, t('pitch.solution.product', { features: Math.round(s.product.features), quality: Math.round(s.product.quality) })] },
      { title: t('pitch.traction'), lines: [
        t('pitch.traction.customers', { n: s.customers }),
        t('pitch.traction.revenue', { rev: st.revenue, arr: st.revenue * 52 }),
        t('pitch.traction.growth', { g: Math.round(g * 1000) / 10 }),
        t('pitch.traction.churn', { c: s.customers ? Math.round((st.churned / Math.max(1, s.customers)) * 1000) / 10 : 0 }),
      ] },
      { title: t('pitch.market'), lines: [t(`pitch.market.${seg}`), t('pitch.market.share', { share: Math.round((s.customers / leagueCustomers) * 100) })] },
      { title: t('pitch.model'), lines: [
        t('pitch.model.price', { price: s.product.price }),
        t('pitch.model.margin', { m: Math.round(margin * 100) }),
        cac > 0 ? t('pitch.model.cac', { cac }) : t('pitch.model.nocac'),
      ] },
      { title: t('pitch.team'), lines: [
        t('pitch.team.size', { n: team.length }),
        Object.entries(byRole).map(([r, n]) => `${t(`role.${r}`)} × ${n}`).join(' · '),
        top ? t('pitch.team.star', { name: top.name, role: top.role }) : '',
      ].filter(Boolean) },
      { title: t('pitch.competition'), lines: rivals.length ? rivals.map((r) => t('pitch.competition.rival', { name: r.name, val: r.valuation, n: r.customers })) : [t('pitch.competition.none')] },
      { title: t('pitch.financials'), lines: [
        t('pitch.fin.cash', { cash: s.cash }),
        burn > 0 ? t('pitch.fin.burn', { burn, runway: st.runwayWeeks }) : t('pitch.fin.profit', { p: -st.burn }),
        t('pitch.fin.raised', { n: s.rounds.length, total: s.rounds.reduce((a, r) => a + r.amount, 0) }),
        t('pitch.fin.founders', { pct: Math.round(founders(s) * 100) }),
      ] },
      { title: t('pitch.ask'), kicker: t('pitch.ask.kicker', { stage }), lines: [
        t('pitch.ask.amount', { amount: ask, val: Math.round(s.valuation) }),
        ...spend.map(([k, v]) => t('pitch.ask.use', { what: t(`spend.${k}`), pct: Math.round((v / spendTotal) * 100) })),
      ] },
    ],
  };
}

export function pitchMarkdown(deck) {
  return `# ${deck.title}\n\n` + deck.slides.map((s, i) => `## ${i + 1}. ${s.title}\n${s.kicker ? `_${s.kicker}_\n` : ''}\n${s.lines.map((l) => `- ${l}`).join('\n')}\n`).join('\n');
}

/* ───────────────────────── obituary / success story ───────────────────────── */
export function companyStory(replay, id, idx, t) {
  const s = snap(replay, id, idx);
  const m = metaOf(replay, id);
  const h = history(replay, id, idx);
  const last = h[h.length - 1] || s;
  const peakVal = Math.max(0, ...h.map((x) => x.valuation));
  const peakCust = Math.max(0, ...h.map((x) => x.customers));
  const peakTeam = Math.max(0, ...h.map((x) => activeOf(x).length));
  const raised = s.rounds.filter((r) => r.week > 0).reduce((a, r) => a + r.amount, 0);
  const evs = replay.events.filter((e) => e.companyId === id && e.week <= replay.frames[idx].week);
  const kind = s.status === 'bankrupt' ? 'obituary' : s.status === 'unicorn' ? 'unicorn' : 'story';
  const deathWeek = s.status === 'bankrupt' ? last.stat.week : null;
  const reasons = [];

  if (kind === 'obituary') {
    const tail = h.slice(-13);
    const burned = tail.reduce((a, x) => a + Math.max(0, x.stat.burn), 0);
    const arrGain = (tail[tail.length - 1]?.stat.revenue - (tail[0]?.stat.revenue || 0)) * 52;
    if (arrGain <= 0 || burned / Math.max(1, arrGain) > 4) reasons.push(t('story.cause.burn'));
    const rejected = evs.filter((e) => e.kind === 'raise_rejected' && e.importance >= 2).length;
    if (rejected >= 2) reasons.push(t('story.cause.investors', { n: rejected }));
    const churnRate = tail.reduce((a, x) => a + x.stat.churned, 0) / Math.max(1, tail.reduce((a, x) => a + x.customers, 0));
    if (churnRate > 0.03) reasons.push(t('story.cause.churn', { pct: Math.round(churnRate * 100) }));
    if (s.product.techDebt > 60) reasons.push(t('story.cause.debt'));
    if (s.product.quality < 40) reasons.push(t('story.cause.quality'));
    if (evs.some((e) => e.kind === 'pivot')) reasons.push(t('story.cause.pivot'));
    if (evs.some((e) => e.kind === 'ceo_ousted')) reasons.push(t('story.cause.ceo'));
    if (replay.frames[idx].market.climate < 0.75) reasons.push(t('story.cause.market'));
    if (!reasons.length) reasons.push(t('story.cause.cash'));
  } else {
    const firstRaise = s.rounds.find((r) => r.week > 0);
    if (firstRaise) reasons.push(t('story.win.raise', { stage: firstRaise.name, week: firstRaise.week, amount: firstRaise.amount }));
    if (evs.some((e) => e.kind === 'milestone' && e.msg?.key === 'ev.milestoneProfit')) reasons.push(t('story.win.profit'));
    if (s.product.quality >= 70) reasons.push(t('story.win.quality', { q: Math.round(s.product.quality) }));
    const g = growth(h, 26, 'customers');
    if (g > 0.02) reasons.push(t('story.win.growth', { g: Math.round(g * 1000) / 10 }));
    const uni = evs.find((e) => e.kind === 'unicorn');
    if (uni) reasons.push(t('story.win.unicorn', { week: uni.week }));
    if (!reasons.length) reasons.push(t('story.win.alive'));
  }

  return {
    kind,
    name: s.name,
    brain: m.brainLabel,
    tagline: m.tagline,
    kicker: t(`story.kicker.${kind}`),
    headline: kind === 'obituary'
      ? t('story.head.obituary', { name: s.name, week: deathWeek })
      : kind === 'unicorn' ? t('story.head.unicorn', { name: s.name, val: s.valuation }) : t('story.head.story', { name: s.name, week: replay.frames[idx].week }),
    dates: kind === 'obituary' ? t('story.dates.dead', { week: deathWeek }) : t('story.dates.alive', { week: replay.frames[idx].week }),
    stats: [
      [t('story.stat.peakVal'), peakVal, 'money'],
      [t('story.stat.raised'), raised, 'money'],
      [t('story.stat.peakCust'), peakCust, 'int'],
      [t('story.stat.peakTeam'), peakTeam, 'int'],
    ],
    reasons: reasons.slice(0, 4),
    epitaph: kind === 'obituary' ? t('story.epitaph', { brain: m.brainLabel }) : t('story.ceo', { brain: m.brainLabel }),
  };
}

/* ───────────────────────── board meeting replay ───────────────────────── */
export function boardQuarters(replay, id, idx) {
  const week = replay.frames[idx].week;
  const qs = [];
  for (let q = 1; q * 13 <= week; q++) {
    const s = snap(replay, id, q * 13);
    if (s && s.stat.week === q * 13) qs.push(q);
  }
  return qs;
}

export function boardDeck(replay, id, q, t) {
  const end = q * 13, start = Math.max(0, end - 13);
  const s1 = snap(replay, id, end), s0 = snap(replay, id, start);
  const a = s1.stat, b = s0.stat;
  const pct = (x, y) => (y > 0 ? Math.round((x / y - 1) * 100) : 0);
  const evs = replay.events.filter((e) => e.companyId === id && e.week > start && e.week <= end);
  const count = (k) => evs.filter((e) => e.kind === k).length;
  const hires = evs.filter((e) => e.kind === 'hire').reduce((n, e) => n + (e.data?.count || 1), 0);
  const board = evs.find((e) => e.kind === 'board' && e.msg?.key === 'ev.board');
  const mood = board?.msg?.params?.mood || 'flat';
  const highlights = evs.filter((e) => e.importance >= 2 && !['board', 'memo', 'chat'].includes(e.kind)).slice(-6);
  const memo = [...evs].reverse().find((e) => e.kind === 'memo');
  const verdicts = evs.filter((e) => (e.kind === 'board' && e.msg?.key !== 'ev.board') || e.kind === 'ceo_ousted');
  return {
    q, mood, start, end,
    slides: [
      { kind: 'cover', title: t('boardroom.cover', { q, name: s1.name }), sub: t('boardroom.weeks', { from: start + 1, to: end }) },
      { kind: 'kpis', title: t('boardroom.numbers'), rows: [
        [t('kpi.revenue'), a.revenue, pct(a.revenue, b.revenue), 'money'],
        [t('kpi.customers'), s1.customers, pct(s1.customers, s0.customers), 'int'],
        [t('kpi.cash'), s1.cash, pct(s1.cash, s0.cash), 'money'],
        [t('kpi.burn'), Math.max(0, a.burn), pct(Math.max(0, a.burn), Math.max(0, b.burn)), 'money'],
        [t('kpi.valuation'), s1.valuation, pct(s1.valuation, s0.valuation), 'money'],
        [t('kpi.team'), activeOf(s1).length, pct(activeOf(s1).length, activeOf(s0).length), 'int'],
      ] },
      { kind: 'people', title: t('boardroom.people'), lines: [
        t('boardroom.hires', { n: hires }), t('boardroom.exits', { fired: count('fire'), quit: count('quit') }),
        memo ? t('boardroom.memo', { text: memo.text }) : t('boardroom.nomemo'),
      ] },
      { kind: 'events', title: t('boardroom.happened'), events: highlights },
      { kind: 'verdict', title: t('boardroom.verdict'), mood, events: verdicts },
    ],
  };
}
