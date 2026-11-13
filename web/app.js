// AgentCorp dashboard. Vanilla ES modules, no build step.
// Modes: setup (first-run onboarding), live (SSE), replay (served file) and static (exported HTML).
import { LANGS, detectLang, makeT, eventText, loadLocale, fmtMoney, fmtInt } from './lib/i18n.js';
import { icon, KIND_ICON } from './lib/icons.js';
import { lineChart, divergingBars, sparkline, weekTicks } from './lib/charts.js';
import { tweenNumber, momentQueue, typeIn, reduced } from './lib/motion.js';
import { buildPitch, pitchMarkdown, companyStory, boardQuarters, boardDeck } from './lib/story.js';
import { drawCard, recordReel } from './lib/share.js';
import { mountOnboarding } from './lib/onboarding.js';

const $ = (id) => document.getElementById(id);
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const C = {
  ink: cssVar('--ink'), paper: cssVar('--paper'), paper2: cssVar('--paper-2'), mute: cssVar('--mute'),
  grid: cssVar('--rule'), rule2: cssVar('--rule2'), good: cssVar('--good'), warning: cssVar('--warning'), critical: cssVar('--critical'),
};
const COLORS = Array.from({ length: 8 }, (_, i) => cssVar(`--series-${i + 1}`));
const LANG_NAMES = { en: 'English', ru: 'Русский', kk: 'Қазақша', fr: 'Français', zh: '简体中文', ko: '한국어', es: 'Español', ja: '日本語' };
const CHANNELS = ['general', 'eng', 'deals', 'sales', 'hr', 'board', 'market'];
const MOMENT_KINDS = new Set(['raise', 'bridge', 'bankrupt', 'unicorn', 'pivot', 'ceo_ousted', 'shock']);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

const state = {
  replay: null, mode: 'live', idx: 0, follow: true, sel: null, channel: 'all', playing: true, speed: 2,
  timer: null, es: null, shocks: [], pending: false, animate: true, lastMomentId: 0,
  chatKey: '', chatIds: new Set(), orgKey: '', kpiKey: '', lastWire: '', lastMemo: '',
};
let lang = 'en';
let t = makeT({}, {}, 'en');
const M = (n) => fmtMoney(n, lang);
const I = (n) => fmtInt(n, lang);
const compact = (n) => (Math.abs(n) >= 1e4 ? fmtMoney(n, lang).replace('◈', '') : I(n));
const moments = momentQueue($('moments'));

/* ───────────────────────── data helpers ───────────────────────── */
const frames = () => state.replay.frames;
const frame = () => frames()[state.idx];
const metaOf = (id) => state.replay.companies.find((c) => c.id === id);
const colorOf = (id) => COLORS[(metaOf(id)?.color ?? 0) % COLORS.length];
const snapOf = (id, f = frame()) => f.companies.find((c) => c.id === id);
const activeOf = (s) => s.employees.filter((e) => e.status === 'active');
const txt = (ev) => eventText(ev, t);

function series(id, fn) {
  const out = [];
  const fr = frames();
  for (let i = 1; i <= state.idx; i++) {
    const s = fr[i].companies.find((c) => c.id === id);
    if (s && s.stat.week === fr[i].week) out.push({ x: fr[i].week, y: fn(s, fr[i]) });
  }
  return out;
}
function eventsUntil(week) {
  const ev = state.replay.events;
  let hi = ev.length;
  while (hi > 0 && ev[hi - 1].week > week) hi--;
  return ev.slice(0, hi);
}
function founderShare(s) {
  const total = s.capTable.reduce((a, h) => a + h.shares, 0) || 1;
  return s.capTable.filter((h) => h.kind === 'founder').reduce((a, h) => a + h.shares, 0) / total;
}
function leagueRows(f = frame()) {
  return f.companies.map((s) => ({
    id: s.id, name: s.name, brain: metaOf(s.id).brainLabel, status: s.status, valuation: s.status === 'bankrupt' ? 0 : s.valuation,
    arr: s.revenue * 52, customers: s.customers, team: activeOf(s).length, runway: s.stat.runwayWeeks, founders: founderShare(s), cash: s.cash,
  })).sort((a, b) => b.valuation - a.valuation || b.arr - a.arr || b.cash - a.cash);
}
const brainName = (label) => (label in { 'Steady Operator': 1, Blitzscaler: 1, Bootstrapper: 1, Visionary: 1 } ? t(`brain.${({ 'Steady Operator': 'balanced', Blitzscaler: 'blitzscaler', Bootstrapper: 'bootstrapper', Visionary: 'visionary' })[label]}`) : label);

/* ───────────────────────── tooltip ───────────────────────── */
const tipEl = $('tooltip');
const tip = {
  show(html, x, y) {
    tipEl.innerHTML = html;
    tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tipEl.style.left = `${Math.max(8, left)}px`;
    tipEl.style.top = `${Math.max(8, top)}px`;
  },
  hide() { tipEl.hidden = true; },
};
const chartCtx = () => ({ C, tip, fmtY: M, fmtX: (w, long) => (long ? t('ui.weekN', { n: w }) : `W${w}`), animate: state.animate && !reduced() });

/* ───────────────────────── shell ───────────────────────── */
function shell() {
  $('app').innerHTML = `
  <header class="mast">
    <div class="mast-inner">
      <div><h1 class="word">AgentCorp</h1><div class="edition" id="edition"></div></div>
      <div class="scrub"><div class="scrub-top"><span id="wk-label"></span><b id="wk-now"></b></div><input type="range" id="scrubber" min="0" max="0" value="0" aria-label="${esc(t('ui.week'))}"></div>
      <div class="ctrls">
        <button class="btn" id="btn-play"></button>
        <select class="btn" id="speed" aria-label="${esc(t('ui.speed'))}"><option value="1">1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option><option value="0">${esc(t('ui.max'))}</option></select>
        <button class="btn" id="btn-live">${icon('live')}<span class="lbl">${esc(t('ui.live'))}</span></button>
        <select class="btn" id="shock" aria-label="${esc(t('ui.shock'))}"></select>
        <button class="btn" id="btn-download" title="${esc(t('ui.download'))}">${icon('download')}<span class="lbl">${esc(t('ui.replay'))}</span></button>
        <label class="btn file-btn" title="${esc(t('ui.open'))}">${icon('upload')}<span class="lbl">${esc(t('ui.open'))}</span><input type="file" id="file" accept=".json,application/json"></label>
        <select class="btn" id="lang" aria-label="${esc(t('ui.language'))}">${LANGS.map((l) => `<option value="${l}"${l === lang ? ' selected' : ''}>${LANG_NAMES[l]}</option>`).join('')}</select>
      </div>
    </div>
    <div class="rule-double"></div>
    <div class="wire"><span class="wire-tag">${esc(t('ui.wire'))}</span><span class="wire-text" id="wire"></span><span class="climate" id="climate"></span></div>
  </header>
  <main class="wrap">
    <div id="banner"></div>
    <section class="sec cols c-7-5">
      <div><div class="sec-label"><h2><span>01</span>${esc(t('sec.league'))}</h2><span class="aside">${esc(t('sec.league.aside'))}</span></div><div class="table-scroll"><table class="league" id="league"></table></div></div>
      <div><div class="sec-label"><h2><span>02</span>${esc(t('sec.race'))}</h2><span class="aside">${esc(t('sec.race.aside'))}</span></div><div class="chart" id="chart-league"></div><div class="legend" id="legend-league"></div></div>
    </section>
    <nav class="tabs" id="tabs" role="tablist"></nav>
    <section class="company" id="company"></section>
    <section class="kpis" id="kpis"></section>
    <section class="sec cols c-1-1">
      <div><div class="sec-label"><h2><span>03</span>${esc(t('sec.cash'))}</h2><span class="aside">${esc(t('sec.cash.aside'))}</span></div><div class="chart" id="chart-cash"></div></div>
      <div><div class="sec-label"><h2><span>04</span>${esc(t('sec.pnl'))}</h2><div class="legend inline" id="legend-pnl"></div></div><div class="chart" id="chart-pnl"></div></div>
    </section>
    <section class="sec cols c-1-1">
      <div><div class="sec-label"><h2><span>05</span>${esc(t('sec.customers'))}</h2><div class="legend inline" id="legend-cust"></div></div><div class="chart" id="chart-cust"></div></div>
      <div><div class="sec-label"><h2><span>06</span>${esc(t('sec.spend'))}</h2><span class="aside" id="spend-note"></span></div><div id="spend"></div>
        <div class="sec-label" style="margin-top:22px"><h2><span>07</span>${esc(t('sec.cap'))}</h2><span class="aside" id="cap-note"></span></div><div id="captable"></div></div>
    </section>
    <section class="sec cols c-1-1">
      <div><div class="sec-label"><h2><span>08</span>${esc(t('sec.org'))}</h2><span class="aside" id="org-note"></span></div><div id="org"></div></div>
      <div><div class="sec-label"><h2><span>09</span>${esc(t('sec.slack'))}</h2><span class="aside" id="chat-note"></span></div><div class="slack"><ul class="channels" id="channels"></ul><ol class="messages" id="messages"></ol></div></div>
    </section>
    <section class="sec"><div class="sec-label"><h2><span>10</span>${esc(t('sec.timeline'))}</h2><span class="aside">${esc(t('sec.timeline.aside'))}</span></div><div class="chart" id="timeline"></div></section>
    <section class="sec cols c-1-1">
      <div><div class="sec-label"><h2><span>11</span>${esc(t('sec.market'))}</h2><span class="aside">${esc(t('sec.market.aside'))}</span></div><ol class="bounties" id="bounties"></ol></div>
      <div><div class="sec-label"><h2><span>12</span>${esc(t('sec.earners'))}</h2><span class="aside">${esc(t('sec.earners.aside'))}</span></div><div id="earners"></div></div>
    </section>
    <footer class="foot"><span>${esc(t('ui.footer'))}</span><a href="https://github.com/bitovvnew/agentcorp" target="_blank" rel="noopener noreferrer">GitHub</a></footer>
  </main>`;
  state.chatKey = state.orgKey = state.kpiKey = '';
  bindControls();
  $('shock').innerHTML = `<option value="">${esc(t('ui.shock'))}</option>${state.shocks.map((s) => `<option value="${s.id}">${esc(t(`shock.${s.id}`))}</option>`).join('')}`;
  $('speed').value = String([1, 2, 5, 10, 0].includes(state.speed) ? state.speed : 2);
}

/* ───────────────────────── renderers ───────────────────────── */
function renderTop() {
  const r = state.replay, f = frame(), last = frames().length - 1;
  $('edition').innerHTML = `<b>${esc(t('ui.edition', { v: r.generator?.split('@').at(-1) ?? '—' }))}</b> · ${esc(t(`scn.${r.scenario.id}`) === `scn.${r.scenario.id}` ? r.scenario.name : t(`scn.${r.scenario.id}`))} · ${esc(t('ui.seed', { n: r.config.seed }))}`;
  $('wk-label').textContent = t(`mode.${state.mode}`);
  $('wk-now').textContent = t('ui.weekOf', { n: f.week, of: r.config.weeks });
  const sc = $('scrubber');
  sc.max = String(last);
  sc.value = String(state.idx);
  sc.style.setProperty('--p', `${last ? (state.idx / last) * 100 : 0}%`);
  const live = state.mode === 'live';
  $('btn-live').hidden = !live;
  $('btn-live').classList.toggle('live', live && state.follow && !r.finished);
  $('shock').hidden = !live || r.finished;
  const playing = state.playing && !(state.mode !== 'live' && state.idx >= last);
  const playLabel = t(playing ? 'ui.pause' : 'ui.play');
  $('btn-play').setAttribute('aria-label', playLabel);
  $('btn-play').innerHTML = `${icon(playing ? 'pause' : 'play')}<span class="lbl">${esc(playLabel)}</span>`;
}

function renderWire() {
  const f = frame();
  const ev = eventsUntil(f.week).filter((e) => !e.companyId && (e.kind === 'market' || e.kind === 'shock'));
  const latest = ev[ev.length - 1];
  const text = latest ? `W${latest.week} — ${txt(latest)}` : t('wire.calm');
  const w = $('wire');
  if (text !== state.lastWire) {
    state.lastWire = text;
    w.textContent = text;
    w.classList.remove('swap');
    if (state.animate || state.mode === 'live') { void w.offsetWidth; w.classList.add('swap'); }
  }
  const cl = f.market.climate;
  const key = cl < 0.7 ? 'winter' : cl < 0.95 ? 'cautious' : cl < 1.2 ? 'normal' : 'hot';
  $('climate').innerHTML = `${esc(t(`climate.${key}`))} <i style="--c:${Math.min(100, (cl / 1.9) * 100)}%"></i> ${cl.toFixed(2)}×`;
}

function renderBanner() {
  const r = state.replay, b = $('banner');
  if (r.finished && state.idx === frames().length - 1) {
    const rows = leagueRows(), w = rows[0];
    b.className = 'banner';
    b.innerHTML = `<span class="k">${esc(t('banner.over'))}</span><span class="h">${esc(t('banner.winner', { name: w.name, brain: brainName(w.brain), val: w.valuation }))}</span><span class="k">${esc(t('banner.stats', { u: rows.filter((x) => x.status === 'unicorn').length, d: rows.filter((x) => x.status === 'bankrupt').length }))}</span>`;
  } else { b.className = ''; b.innerHTML = ''; }
}

function statusTag(status, runway) {
  if (status === 'unicorn') return `<span class="tag unicorn">${icon('unicorn')} ${esc(t('status.unicorn'))}</span>`;
  if (status === 'bankrupt') return `<span class="tag critical">${icon('dead')} ${esc(t('status.dead'))}</span>`;
  if (runway < 13) return `<span class="tag critical">${icon('warn')} ${esc(t('status.critical'))}</span>`;
  if (runway < 26) return `<span class="tag warning">${icon('warn')} ${esc(t('status.tight'))}</span>`;
  if (runway >= 999) return `<span class="tag good">${icon('check')} ${esc(t('status.profitable'))}</span>`;
  return `<span class="tag good">${icon('check')} ${esc(t('status.operating'))}</span>`;
}

function renderLeague() {
  const rows = leagueRows();
  const head = `<thead><tr><th></th><th>${esc(t('col.company'))}</th><th>${esc(t('col.status'))}</th><th class="n">${esc(t('col.valuation'))}</th><th class="n">ARR</th><th class="n">${esc(t('col.customers'))}</th><th class="n">${esc(t('col.team'))}</th><th class="n">${esc(t('col.runway'))}</th><th class="n">${esc(t('col.founders'))}</th></tr></thead>`;
  const body = rows.map((r, i) => `<tr class="row${r.id === state.sel ? ' sel' : ''}${r.status === 'bankrupt' ? ' dead' : ''}" data-id="${r.id}" tabindex="0">
    <td class="rank">${i + 1}</td>
    <td><div class="co"><span class="sw" style="background:${colorOf(r.id)}"></span><div><div class="co-name">${esc(r.name)}</div><div class="co-brain">${esc(brainName(r.brain))}</div></div></div></td>
    <td>${statusTag(r.status, r.runway)}</td>
    <td class="n">${r.status === 'bankrupt' ? '—' : M(r.valuation)}</td><td class="n">${M(r.arr)}</td><td class="n">${I(r.customers)}</td><td class="n">${r.team}</td>
    <td class="n">${r.status === 'bankrupt' ? '—' : r.runway >= 999 ? '∞' : t('ui.wk', { n: r.runway })}</td><td class="n">${Math.round(r.founders * 100)}%</td></tr>`).join('');
  $('league').innerHTML = head + `<tbody>${body}</tbody>`;
  $('league').querySelectorAll('tr.row').forEach((tr) => {
    const go = () => select(tr.dataset.id);
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function renderRace() {
  const r = state.replay;
  const labelEnds = r.companies.length <= 5 && $('chart-league').clientWidth >= 420;
  lineChart($('chart-league'), {
    series: r.companies.map((c) => ({ name: c.name, color: colorOf(c.id), points: series(c.id, (s) => s.valuation), endLabel: labelEnds ? c.name : undefined })),
    log: true, xMax: r.config.weeks, height: 270, right: labelEnds ? 96 : 16, refLines: [{ y: 1e9, label: t('race.unicornLine') }], label: t('sec.race'),
  }, { ...chartCtx(), animate: state.animate && !reduced() && state.raceFresh });
  state.raceFresh = false;
  $('legend-league').innerHTML = r.companies.map((c) => `<span class="k"><i class="ln" style="background:${colorOf(c.id)}"></i>${esc(c.name)} <span class="mute">${esc(brainName(c.brainLabel))}</span></span>`).join('');
}

function renderTabs() {
  $('tabs').innerHTML = state.replay.companies.map((c) => {
    const s = snapOf(c.id);
    return `<button class="tab" role="tab" aria-selected="${c.id === state.sel}" data-id="${c.id}" style="--tab:${colorOf(c.id)}"><span class="sw" style="background:${colorOf(c.id)}"></span><b>${esc(c.name)}</b><small>${esc(brainName(c.brainLabel))}${s.status === 'bankrupt' ? ` · ${esc(t('status.dead'))}` : ''}</small></button>`;
  }).join('');
  $('tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));
}

function renderCompany() {
  const id = state.sel, m = metaOf(id), s = snapOf(id), col = colorOf(id);
  const memos = eventsUntil(frame().week).filter((e) => e.companyId === id && e.kind === 'memo');
  const memo = memos[memos.length - 1];
  const ceo = activeOf(s).find((e) => e.role === 'ceo') || s.employees.find((e) => e.role === 'ceo');
  const memoKey = memo ? `${id}:${memo.id}` : id;
  const swap = memoKey !== state.lastMemo;
  state.lastMemo = memoKey;
  $('company').innerHTML = `
    <div>
      <div class="kick">${esc(t(`tpl.${m.template}`))} · ${esc(t(`seg.${s.product.segment}`))}</div>
      <h1><span class="sw" style="background:${col}"></span>${esc(s.name)} ${statusTag(s.status, s.stat.runwayWeeks)}</h1>
      <div class="tagline">${esc(m.tagline)}</div>
      <dl class="meta">
        <div><dt>${esc(t('meta.brain'))}</dt><dd>${esc(brainName(m.brainLabel))}</dd></div>
        <div><dt>${esc(t('meta.ceo'))}</dt><dd>${esc(ceo ? ceo.name : m.ceoName)}</dd></div>
        <div><dt>${esc(t('meta.focus'))}</dt><dd>${esc(t(`focus.${s.focus}`))}</dd></div>
        <div><dt>${esc(t('meta.price'))}</dt><dd>${M(s.product.price)}</dd></div>
        ${s.llmTokens ? `<div><dt>${esc(t('meta.tokens'))}</dt><dd>${compact(s.llmTokens)}</dd></div>` : ''}
      </dl>
      <div class="actions">
        <button class="btn" data-act="board">${icon('board')} ${esc(t('act.board'))}</button>
        <button class="btn" data-act="pitch">${icon('deck')} ${esc(t('act.pitch'))}</button>
        <button class="btn" data-act="card">${icon('card')} ${esc(t(s.status === 'bankrupt' ? 'act.obituary' : 'act.story'))}</button>
        <button class="btn" data-act="reel">${icon('film')} ${esc(t('act.reel'))}</button>
      </div>
    </div>
    <blockquote class="memo${swap ? ' swap' : ''}" style="--memo:${col};margin:0">
      ${memo ? `<q>${esc(memo.text)}</q><div class="who">${esc(t('memo.who', { name: memo.author || 'CEO', week: memo.week }))}</div>` : `<span class="mute">${esc(t('memo.none'))}</span>`}
    </blockquote>`;
  $('company').querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => ACTIONS[b.dataset.act]()));
}

function renderKpis() {
  const id = state.sel, s = snapOf(id), col = colorOf(id), st = s.stat;
  const back = snapOf(id, frames()[Math.max(0, state.idx - 4)]);
  const dead = s.status === 'bankrupt';
  const sp = (fn) => sparkline(series(id, fn).slice(-26), col);
  const delta = (now, then) => {
    if (then === undefined || then === null) return '';
    if (!then) return now ? `<span class="up">${esc(t('kpi.new'))}</span>` : `<span class="mute">${esc(t('kpi.flat'))}</span>`;
    const d = now / then - 1;
    if (Math.abs(d) < 0.005) return `<span class="mute">${esc(t('kpi.flat'))}</span>`;
    return `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${(d * 100).toFixed(Math.abs(d) < 0.1 ? 1 : 0)}%</span> <span class="mute">${esc(t('kpi.vs4'))}</span>`;
  };
  const runway = st.runwayWeeks;
  const fuel = dead ? 0 : runway >= 999 ? 100 : Math.min(100, (runway / 104) * 100);
  const fc = dead ? C.critical : runway >= 999 || runway >= 26 ? C.paper : runway >= 13 ? C.warning : C.critical;
  const cells = [
    ['cash', t('kpi.cash'), s.cash, M, delta(s.cash, back?.cash), sp((x) => x.cash)],
    ['runway', t('kpi.runway'), dead ? 0 : Math.min(runway, 999), (v) => (dead ? '—' : runway >= 999 ? '∞' : t('ui.wk', { n: Math.round(v) })),
      dead ? esc(t('status.dead')) : runway >= 999 ? esc(t('status.profitable')) : runway < 13 ? esc(t('status.critical')) : runway < 26 ? esc(t('status.tight')) : esc(t('status.healthy')),
      `<div class="fuel${!dead && runway < 13 ? ' low' : ''}"><i style="--f:${fuel}%;--fc:${fc}"></i></div><div class="fuel-scale"><span>0</span><span>${esc(t('kpi.oneYear'))}</span><span>${esc(t('kpi.twoYears'))}</span></div>`],
    ['revenue', t('kpi.revenue'), st.revenue, M, `ARR ${M(st.revenue * 52)} · ${delta(st.revenue, back?.stat.revenue)}`, sp((x) => x.stat.revenue)],
    ['burn', t(st.burn > 0 ? 'kpi.burn' : 'kpi.profit'), Math.abs(st.burn), (v) => (st.burn > 0 ? M(v) : `+${M(v)}`), esc(t('kpi.costs', { c: M(st.costs) })), sp((x) => -x.stat.burn)],
    ['customers', t('kpi.customers'), s.customers, I, esc(t('kpi.wonLost', { w: I(st.newCustomers), l: I(st.churned) })), sp((x) => x.customers)],
    ['team', t('kpi.team'), activeOf(s).length, I, back ? delta(activeOf(s).length, activeOf(back).length) : '', sp((x) => activeOf(x).length)],
    ['valuation', t('kpi.valuation'), dead ? 0 : s.valuation, (v) => (dead ? '—' : M(v)), delta(s.valuation, back?.valuation), sp((x) => x.valuation)],
    ['quality', t('kpi.quality'), s.product.quality, (v) => `${Math.round(v)}`, esc(t('kpi.debt', { d: Math.round(s.product.techDebt), f: Math.round(s.product.features) })), sp((x) => x.product.quality)],
  ];
  const key = `${id}|${lang}`;
  if (state.kpiKey !== key) {
    state.kpiKey = key;
    $('kpis').innerHTML = cells.map(([k, l]) => `<div class="kpi" data-k="${k}"><div class="l">${esc(l)}</div><div class="v"></div><div class="d"></div><div class="x"></div></div>`).join('');
  }
  for (const [k, l, v, f, d, x] of cells) {
    const el = $('kpis').querySelector(`[data-k="${k}"]`);
    el.querySelector('.l').textContent = l;
    const vEl = el.querySelector('.v');
    if (k === 'quality') vEl.innerHTML = `<span></span><small>/100</small>`;
    tweenNumber(k === 'quality' ? vEl.querySelector('span') : vEl, v, f);
    el.querySelector('.d').innerHTML = d;
    el.querySelector('.x').innerHTML = x;
  }
}

function renderCash() {
  const id = state.sel, s = snapOf(id), col = colorOf(id);
  const pts = series(id, (x) => x.cash);
  const markers = s.rounds.filter((r) => r.week > 0 && r.week <= frame().week).map((r) => {
    const p = pts.find((q) => q.x === r.week);
    return p ? { x: r.week, y: p.y, label: r.name.replace('Series ', '').replace('Growth round', 'G').replace('Bridge', 'BR'), color: col } : null;
  }).filter(Boolean);
  lineChart($('chart-cash'), {
    series: [{ name: t('kpi.cash'), color: col, points: pts, area: true }], markers, xMax: state.replay.config.weeks, height: 230, label: t('sec.cash'),
    tipExtra: (wk) => {
      const r = s.rounds.find((x) => x.week === wk);
      return r ? `<div class="p"><b>${esc(r.name)}</b> · ${M(r.amount)} · ${esc(r.investor)}</div>` : '';
    },
  }, chartCtx());
}

function renderPnl() {
  const id = state.sel, col = colorOf(id);
  lineChart($('chart-pnl'), {
    series: [
      { name: t('pnl.revenue'), color: col, points: series(id, (x) => x.stat.revenue) },
      { name: t('pnl.costs'), color: C.paper2, points: series(id, (x) => x.stat.costs), dash: true, width: 1.5 },
    ], xMax: state.replay.config.weeks, height: 230, label: t('sec.pnl'),
  }, chartCtx());
  $('legend-pnl').innerHTML = `<span class="k"><i class="ln" style="background:${col}"></i>${esc(t('pnl.revenue'))}</span><span class="k"><i class="ln dash"></i>${esc(t('pnl.costs'))}</span>`;
}

function renderCustomers() {
  const id = state.sel, col = colorOf(id);
  divergingBars($('chart-cust'), {
    up: series(id, (x) => x.stat.newCustomers), down: series(id, (x) => x.stat.churned), upColor: col, downColor: C.mute,
    upLabel: t('cust.won'), downLabel: t('cust.lost'), fmtCount: compact, xMax: state.replay.config.weeks, height: 210, label: t('sec.customers'),
  }, chartCtx());
  $('legend-cust').innerHTML = `<span class="k"><i class="bx" style="background:${col}"></i>${esc(t('cust.won'))}</span><span class="k"><i class="bx" style="background:${C.mute}"></i>${esc(t('cust.lost'))}</span>`;
}

const SEQ = ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#104281'];
function renderSpend() {
  const st = snapOf(state.sel).stat;
  const parts = [['payroll', st.payroll], ['marketing', st.marketing], ['infra', st.infra], ['bounties', st.bounties], ['ai', st.aiSpend]].filter(([, v]) => v > 0);
  const total = parts.reduce((a, [, v]) => a + v, 0) || 1;
  $('spend-note').textContent = t('spend.note', { w: st.week, total: M(st.costs) });
  $('spend').innerHTML = `<div class="stack" role="img" aria-label="${esc(t('sec.spend'))}">${parts.map(([k, v], i) => `<div style="flex:${v};background:${SEQ[i]}" title="${esc(t(`spend.${k}`))}: ${M(v)}"></div>`).join('')}</div>
    <div class="stack-list">${parts.map(([k, v], i) => `<i class="bx" style="width:10px;height:10px;background:${SEQ[i]}"></i><span class="nm">${esc(t(`spend.${k}`))}</span><span class="v">${M(v)}</span><span class="p">${Math.round((v / total) * 100)}%</span>`).join('')}</div>`;
}

function renderCap() {
  const s = snapOf(state.sel), col = colorOf(state.sel);
  const total = s.capTable.reduce((a, h) => a + h.shares, 0) || 1;
  const inv = s.capTable.filter((h) => h.kind === 'investor');
  const grays = ['#c9c4b6', '#a9a499', '#8b877c', '#6f6c63', '#57554e', '#46443d'];
  const color = (h) => (h.kind === 'founder' ? col : h.kind === 'pool' ? '#2a2925' : grays[inv.indexOf(h) % grays.length]);
  const name = (h) => (h.name === 'Founders' ? t('cap.founders') : h.name === 'Angels' ? t('cap.angels') : h.name === 'Option pool' ? t('cap.pool') : h.name);
  $('cap-note').textContent = t('cap.note', { n: s.rounds.length, pct: Math.round(founderShare(s) * 100) });
  $('captable').innerHTML = `<div class="stack">${s.capTable.map((h) => `<div class="${h.kind === 'pool' ? 'hatch' : ''}" style="flex:${h.shares};background-color:${color(h)}" title="${esc(name(h))}"></div>`).join('')}</div>
    <div class="stack-list">${s.capTable.map((h) => `<i class="bx ${h.kind === 'pool' ? 'hatch' : ''}" style="width:10px;height:10px;background-color:${color(h)}"></i><span class="nm">${esc(name(h))}</span><span class="v">${compact(h.shares)}</span><span class="p">${((h.shares / total) * 100).toFixed(1)}%</span>`).join('')}</div>`;
}

/* org chart: persistent nodes keyed by employee id, so hires pop in and departures shake out */
const DEPTS = [['dept.leadership', ['cto', 'cfo']], ['dept.engineering', ['engineer', 'designer']], ['dept.gtm', ['marketer', 'sales']], ['dept.support', ['support']]];
const ring = (p) => (p >= 1.05 ? C.good : p < 0.6 ? C.critical : p < 0.75 ? C.warning : 'transparent');
const initials = (n) => String(n).split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase();

function personHTML(e, cls) {
  return `<span class="person ${cls}${e.status !== 'active' ? ' gone' : ''}" data-eid="${e.id}" style="--ring:${e.status !== 'active' ? 'transparent' : ring(e.performance)}"><span class="av">${cls.includes('mini') ? '' : initials(e.name)}</span>${cls.includes('mini') ? '' : `<span class="pn">${esc(cls.includes('big') ? `${e.name} · ${t(`role.${e.role}`)}` : e.name.split(' ')[0])}</span>`}</span>`;
}

function renderOrg() {
  const s = snapOf(state.sel);
  const week = frame().week;
  const active = activeOf(s);
  const gone = s.employees.filter((e) => e.status !== 'active');
  $('org-note').textContent = t('org.note', { n: active.length, pay: M(active.reduce((a, e) => a + e.salary, 0)), left: gone.length });
  const key = `${state.sel}|${lang}`;
  const root = $('org');
  const fresh = state.orgKey !== key;
  if (fresh) {
    state.orgKey = key;
    root.innerHTML = `<div class="org-top" id="org-ceo"></div><div class="depts">${DEPTS.map(([k]) => `<div class="dept" data-d="${k}"><h3><span>${esc(t(k))}</span><b>0</b></h3><div class="people"></div></div>`).join('')}</div>
      <div class="org-key"><span><i style="--ring:${C.good}"></i>${esc(t('org.star'))}</span><span><i style="--ring:${C.warning}"></i>${esc(t('org.risk'))}</span><span><i style="--ring:${C.critical}"></i>${esc(t('org.pip'))}</span><span><s>${esc(t('org.name'))}</s> ${esc(t('org.left'))}</span></div>`;
    root.addEventListener('pointermove', orgHover);
    root.addEventListener('pointerleave', tip.hide);
  }
  const ceo = active.find((e) => e.role === 'ceo') || s.employees.find((e) => e.role === 'ceo');
  const ceoBox = root.querySelector('#org-ceo');
  if (ceo && ceoBox.dataset.id !== ceo.id) { ceoBox.dataset.id = ceo.id; ceoBox.innerHTML = personHTML(ceo, `big${fresh ? '' : ' enter'}`); }
  const animate = !fresh && !reduced();
  for (const [k, roles] of DEPTS) {
    const box = root.querySelector(`[data-d="${k}"]`);
    const people = s.employees.filter((e) => roles.includes(e.role) && (e.status === 'active' || (e.leftWeek ?? 0) >= week - 6));
    box.style.display = people.length || k === 'dept.engineering' ? '' : 'none';
    box.querySelector('h3 b').textContent = String(people.filter((e) => e.status === 'active').length);
    const list = box.querySelector('.people');
    const mini = people.length > 36 ? ' mini' : '';
    if (list.dataset.mini !== mini) { list.dataset.mini = mini; list.innerHTML = ''; }
    const want = new Map(people.map((e) => [e.id, e]));
    for (const node of [...list.children]) {
      const e = want.get(node.dataset.eid);
      if (!e) { node.remove(); continue; }
      const wasActive = !node.classList.contains('gone');
      if (wasActive && e.status !== 'active') {
        node.classList.add('gone');
        if (animate) node.classList.add('leave');
        node.style.setProperty('--ring', 'transparent');
      } else if (e.status === 'active') node.style.setProperty('--ring', ring(e.performance));
      want.delete(e.id);
    }
    for (const e of want.values()) {
      const tmp = document.createElement('div');
      tmp.innerHTML = personHTML(e, `${mini}${animate ? ' enter' : ''}`.trim());
      list.appendChild(tmp.firstChild);
    }
  }
  state.orgPeople = new Map(s.employees.map((e) => [e.id, e]));
}
function orgHover(ev) {
  const node = ev.target.closest('[data-eid]');
  if (!node || !state.orgPeople) return tip.hide();
  const e = state.orgPeople.get(node.dataset.eid);
  if (!e) return tip.hide();
  const lvl = e.level === 3 ? t('lvl.senior') : e.level === 1 ? t('lvl.junior') : '';
  tip.show(`<div class="tt">${esc(e.name)}</div><div>${esc(`${lvl} ${t(`role.${e.role}`)}`.trim())} · ${esc(t('org.hired', { w: e.hiredWeek }))}${e.status !== 'active' ? ` · ${esc(t(`org.${e.status}`, { w: e.leftWeek }))}` : ''}</div>
    <div class="tr"><span>${esc(t('org.salary'))}</span><b>${M(e.salary)}</b></div><div class="tr"><span>${esc(t('org.perf'))}</span><b>${e.performance.toFixed(2)}</b></div>
    <div class="tr"><span>${esc(t('org.morale'))}</span><b>${Math.round(e.morale * 100)}%</b></div><div class="tr"><span>${esc(t('org.bounties'))}</span><b>${e.tasksDone} · ${M(e.earned)}</b></div>`, ev.clientX, ev.clientY);
}

/* chat: append-only stream with typing for the newest important line */
const ROLE_KEYS = new Set(['ceo', 'cto', 'engineer', 'designer', 'marketer', 'sales', 'cfo', 'support', 'board', 'investor', 'market', 'system']);
function msgHTML(e, fresh) {
  const who = e.author || 'System';
  const role = ROLE_KEYS.has(e.authorRole) ? t(`role.${e.authorRole}`) : '';
  const av = e.authorRole === 'market' ? icon('news') : e.authorRole === 'board' ? icon('board') : e.authorRole === 'investor' ? icon('money') : e.authorRole === 'system' ? icon(KIND_ICON[e.kind] || 'gear') : esc(initials(who));
  const coBg = e.authorRole === 'ceo' ? `style="background:${colorOf(state.sel)}"` : '';
  return `<li class="msg${e.importance === 3 ? ' big' : ''}${fresh ? ' new' : ''}" data-ev="${e.id}"><span class="av${coBg ? ' co' : ''}" ${coBg}>${av}</span><div><div class="meta"><b>${esc(who)}</b>${role ? `<span class="role">${esc(role)}</span>` : ''}<span>#${esc(e.channel)} · W${e.week}</span></div><div class="txt">${esc(txt(e))}</div></div></li>`;
}
function renderChat() {
  const id = state.sel;
  const all = eventsUntil(frame().week).filter((e) => e.companyId === id || (!e.companyId && e.kind !== 'milestone'));
  const counts = {};
  for (const e of all) counts[e.channel] = (counts[e.channel] || 0) + 1;
  $('channels').innerHTML = [['all', all.length], ...CHANNELS.filter((c) => counts[c]).map((c) => [c, counts[c]])]
    .map(([c, n]) => `<li><button aria-pressed="${state.channel === c}" data-c="${c}"><span>${c === 'all' ? esc(t('chat.all')) : `#${c}`}</span><span class="n">${compact(n)}</span></button></li>`).join('');
  $('channels').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.channel = b.dataset.c; renderChat(); }));
  const list = (state.channel === 'all' ? all : all.filter((e) => e.channel === state.channel)).slice(-160);
  $('chat-note').textContent = t('chat.count', { n: I(all.length) });
  const box = $('messages');
  const key = `${id}|${state.channel}|${lang}`;
  const lastId = list.length ? list[list.length - 1].id : 0;
  const canAppend = key === state.chatKey && lastId >= (state.chatLast || 0) && state.chatIds.size > 0;
  if (!canAppend) {
    state.chatKey = key;
    box.innerHTML = list.length ? list.map((e) => msgHTML(e, false)).join('') : `<li class="empty">${esc(t('chat.empty'))}</li>`;
    state.chatIds = new Set(list.map((e) => e.id));
    state.chatLast = lastId;
    box.scrollTop = box.scrollHeight;
    return;
  }
  const fresh = list.filter((e) => !state.chatIds.has(e.id));
  if (!fresh.length) return;
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.querySelector('.empty')?.remove();
  const html = fresh.slice(-20).map((e) => msgHTML(e, !reduced())).join('');
  box.insertAdjacentHTML('beforeend', html);
  for (const e of fresh) state.chatIds.add(e.id);
  state.chatLast = lastId;
  while (box.children.length > 180) box.firstElementChild.remove();
  const newest = [...fresh].reverse().find((e) => e.importance >= 2);
  if (newest && (state.playing || state.mode === 'live')) {
    const node = box.querySelector(`[data-ev="${newest.id}"] .txt`);
    if (node) typeIn(node, txt(newest), state.speed > 4 ? 220 : 110);
  }
  if (near || state.follow) box.scrollTop = box.scrollHeight;
}

const LANES = [['lane.funding', ['raise', 'bridge', 'raise_rejected']], ['lane.people', ['hire', 'fire', 'quit', 'ceo_ousted']], ['lane.product', ['ship', 'pivot', 'price']],
  ['lane.board', ['board', 'review']], ['lane.milestones', ['milestone', 'unicorn', 'bankrupt', 'brain_error', 'budget']], ['lane.market', ['market', 'shock']]];
const BAD = new Set(['fire', 'quit', 'ceo_ousted', 'bankrupt', 'raise_rejected', 'brain_error', 'budget']);
const GOOD = new Set(['raise', 'unicorn', 'milestone']);
function renderTimeline() {
  const el = $('timeline'), id = state.sel, col = colorOf(id), weeks = state.replay.config.weeks;
  const W = Math.max(320, el.clientWidth || 800), laneH = 28, m = { l: 108, r: 16, t: 6, b: 22 };
  const H = m.t + LANES.length * laneH + m.b, pw = W - m.l - m.r;
  const X = (w) => m.l + (w / Math.max(1, weeks)) * pw;
  const buckets = new Map();
  for (const e of eventsUntil(frame().week)) {
    if (!(e.companyId === id || (!e.companyId && e.kind !== 'milestone'))) continue;
    const lane = LANES.findIndex(([, k]) => k.includes(e.kind));
    if (lane < 0) continue;
    const k = `${lane}:${e.week}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(t('sec.timeline'))}">`;
  LANES.forEach(([name], i) => {
    const y = m.t + i * laneH + laneH / 2;
    svg += `<text class="lane" x="0" y="${y + 4}">${esc(t(name).toUpperCase())}</text><line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${C.grid}"/>`;
  });
  for (const w of weekTicks(weeks)) svg += `<text x="${X(w)}" y="${H - 5}" text-anchor="middle">W${w}</text>`;
  for (const [k, list] of buckets) {
    const [lane, wk] = k.split(':').map(Number);
    const y = m.t + lane * laneH + laneH / 2;
    const top = list.reduce((a, e) => (e.importance > a.importance ? e : a), list[0]);
    const onlyHires = list.every((e) => e.kind === 'hire');
    const fill = lane === 5 || onlyHires ? C.mute : BAD.has(top.kind) ? C.critical : GOOD.has(top.kind) ? C.good : col;
    const r = onlyHires ? 2.5 : Math.min(7, 2.5 + top.importance + Math.log2(list.length));
    svg += top.importance === 3 && !onlyHires
      ? `<rect data-k="${k}" x="${X(wk) - r}" y="${y - r}" width="${r * 2}" height="${r * 2}" fill="${fill}" stroke="${C.ink}" stroke-width="1.5" transform="rotate(45 ${X(wk)} ${y})"/>`
      : `<circle data-k="${k}" cx="${X(wk)}" cy="${y}" r="${r}" fill="${fill}" stroke="${C.ink}" stroke-width="1.5"/>`;
  }
  svg += `<line x1="${X(frame().week)}" x2="${X(frame().week)}" y1="${m.t}" y2="${H - m.b}" stroke="${C.paper}" stroke-opacity=".5" stroke-dasharray="2 3"/></svg>`;
  el.innerHTML = svg;
  el.querySelectorAll('[data-k]').forEach((c) => {
    c.addEventListener('pointermove', (ev) => {
      const list = buckets.get(c.dataset.k) || [];
      showListTip(list, LANES[Number(c.dataset.k.split(':')[0])][0], ev);
    });
    c.addEventListener('pointerleave', tip.hide);
  });
}
function showListTip(list, laneKey, ev) {
  tip.show(`<div class="tt">${esc(t('ui.weekN', { n: list[0]?.week }))} · ${esc(t(laneKey))}</div>${list.slice(0, 6).map((e) => `<div class="p">${esc(txt(e))}</div>`).join('')}${list.length > 6 ? `<div class="p">+${list.length - 6}</div>` : ''}`, ev.clientX, ev.clientY);
}

function renderBounties() {
  const id = state.sel;
  const list = eventsUntil(frame().week).filter((e) => e.companyId === id && (e.kind === 'bounty' || e.kind === 'ship')).slice(-16).reverse();
  $('bounties').innerHTML = list.length ? list.map((e) => `<li><span class="wk">W${e.week}</span><span>${esc(txt(e))}</span></li>`).join('') : `<li class="empty">${esc(t('bounty.none'))}</li>`;
  const s = snapOf(id), col = colorOf(id);
  const top = [...s.employees].filter((e) => e.earned > 0).sort((a, b) => b.earned - a.earned).slice(0, 8);
  const max = top[0]?.earned || 1;
  $('earners').innerHTML = top.length ? `<div class="earn">${top.map((e) => `<div><div>${esc(e.name)} <span class="mute small">${esc(t(`role.${e.role}`))}${e.status !== 'active' ? ` · ${esc(t(`org.${e.status}`, { w: e.leftWeek }))}` : ''}</span></div><div class="bar" style="width:${Math.max(3, (e.earned / max) * 100)}%;background:${col}"></div></div><span class="v mute">${esc(t('earn.tasks', { n: e.tasksDone }))}</span><span class="v">${M(e.earned)}</span>`).join('')}</div>` : `<div class="empty">${esc(t('earn.none'))}</div>`;
}

function emitMoments() {
  if (state.mode === 'live' ? !state.follow : !state.playing) { state.lastMomentId = Math.max(state.lastMomentId, lastEventIdUntil()); return; }
  const upto = lastEventIdUntil();
  for (const e of state.replay.events) {
    if (e.id <= state.lastMomentId || e.id > upto) continue;
    if (e.importance !== 3 || !MOMENT_KINDS.has(e.kind)) continue;
    const name = e.companyId ? metaOf(e.companyId)?.name : '';
    const p = e.msg?.params || {};
    let k, h, s = '', tone = '';
    if (e.kind === 'raise') { k = p.stage; h = t('moment.raise', { name, amount: M(p.amount) }); s = t('moment.raiseSub', { vc: p.vc, pre: M(p.pre) }); }
    else if (e.kind === 'bridge') { k = t('moment.bridgeK'); h = t('moment.bridge', { name, amount: M(p.amount) }); tone = 'bad'; }
    else if (e.kind === 'bankrupt') { k = t('moment.deadK'); h = t('moment.dead', { name }); s = t('ui.weekN', { n: e.week }); tone = 'bad'; }
    else if (e.kind === 'unicorn') { k = t('moment.unicornK'); h = t('moment.unicorn', { name, val: M(e.msg?.params?.valuation ?? 1e9) }); }
    else if (e.kind === 'pivot') { k = t('moment.pivotK'); h = txt(e); }
    else if (e.kind === 'ceo_ousted') { k = t('moment.ousterK'); h = txt(e); tone = 'bad'; }
    else { k = t('moment.shockK'); h = txt(e); }
    moments.push({ tone, html: `<div class="k">${icon(KIND_ICON[e.kind] || 'bolt')} ${esc(k)}</div><div class="h">${esc(h)}</div>${s ? `<div class="s">${esc(s)}</div>` : ''}` });
  }
  state.lastMomentId = Math.max(state.lastMomentId, upto);
}
function lastEventIdUntil() {
  const ev = eventsUntil(frame().week);
  return ev.length ? ev[ev.length - 1].id : 0;
}

function render() {
  state.pending = false;
  if (!state.replay) return;
  if (!state.sel || !metaOf(state.sel)) state.sel = leagueRows()[0]?.id || state.replay.companies[0].id;
  renderTop(); renderWire(); renderBanner(); renderLeague(); renderRace(); renderTabs(); renderCompany(); renderKpis();
  renderCash(); renderPnl(); renderCustomers(); renderSpend(); renderCap(); renderOrg(); renderChat(); renderTimeline(); renderBounties();
  emitMoments();
  state.animate = false;
}
function scheduleRender() {
  if (state.pending) return;
  state.pending = true;
  requestAnimationFrame(render);
}
function select(id) {
  if (state.sel === id) return;
  state.sel = id;
  state.animate = true;
  render();
  document.getElementById('tabs').scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
}

/* ───────────────────────── modals & features ───────────────────────── */
function openModal(title, body, foot = '') {
  const modal = $('modal');
  const card = modal.querySelector('.modal-card');
  card.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(title)}</h2><button class="icon-btn" data-close aria-label="${esc(t('ui.close'))}">${icon('close')}</button></div><div class="modal-body"></div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}`;
  card.setAttribute('aria-labelledby', 'modal-title');
  card.querySelector('.modal-body').innerHTML = body;
  modal.hidden = false;
  card.querySelector('[data-close]').addEventListener('click', closeModal);
  card.querySelector('[data-close]').focus();
  return card;
}
function closeModal() {
  const modal = $('modal');
  clearInterval(state.slideTimer);
  modal.hidden = true;
  modal.querySelector('.modal-card').innerHTML = '';
}
$('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });

function slideshow(card, slides, renderSlide, auto = false) {
  let i = 0;
  const body = card.querySelector('.modal-body');
  const foot = card.querySelector('.modal-foot .dots');
  const show = (n) => {
    i = (n + slides.length) % slides.length;
    body.innerHTML = `<div class="slide">${renderSlide(slides[i], i)}</div>`;
    foot.innerHTML = slides.map((_, k) => `<button class="${k === i ? 'on' : ''}" data-s="${k}" aria-label="${k + 1}"></button>`).join('');
    foot.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { clearInterval(state.slideTimer); show(+b.dataset.s); }));
  };
  card.querySelector('[data-prev]').addEventListener('click', () => { clearInterval(state.slideTimer); show(i - 1); });
  card.querySelector('[data-next]').addEventListener('click', () => { clearInterval(state.slideTimer); show(i + 1); });
  card.addEventListener('keydown', (e) => { if (e.key === 'ArrowRight') show(i + 1); if (e.key === 'ArrowLeft') show(i - 1); });
  show(0);
  clearInterval(state.slideTimer);
  if (auto && !reduced()) state.slideTimer = setInterval(() => { if (i === slides.length - 1) clearInterval(state.slideTimer); else show(i + 1); }, 4200);
}
const navFoot = (extra = '') => `<div class="dots"></div><div style="display:flex;gap:6px;flex-wrap:wrap">${extra}<button class="btn" data-prev>${icon('prev')}</button><button class="btn primary" data-next>${icon('next')}</button></div>`;

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company';

const ACTIONS = {
  board() {
    const qs = boardQuarters(state.replay, state.sel, state.idx);
    if (!qs.length) { openModal(t('act.board'), `<p class="empty">${esc(t('boardroom.none'))}</p>`); return; }
    const pick = `<select class="btn" data-q>${qs.map((q) => `<option value="${q}"${q === qs[qs.length - 1] ? ' selected' : ''}>Q${q}</option>`).join('')}</select>`;
    const card = openModal(t('act.board'), '', navFoot(pick));
    const play = (q) => {
      const deck = boardDeck(state.replay, state.sel, q, t);
      slideshow(card, deck.slides, (s) => {
        if (s.kind === 'cover') return `<div class="kick">${esc(t('boardroom.kicker'))}</div><h3>${esc(s.title)}</h3><p class="mood">${esc(t(`mood.${deck.mood}`))}</p><p class="mute">${esc(s.sub)}</p>`;
        if (s.kind === 'kpis') return `<div class="kick">${esc(t('boardroom.kicker'))}</div><h3>${esc(s.title)}</h3><div class="kgrid">${s.rows.map(([l, v, d, f]) => `<div><div class="l">${esc(l)}</div><div class="v">${f === 'money' ? M(v) : I(v)}</div><div class="d">${d >= 0 ? '▲' : '▼'} ${Math.abs(d)}% ${esc(t('boardroom.qoq'))}</div></div>`).join('')}</div>`;
        if (s.kind === 'people') return `<div class="kick">${esc(t('boardroom.kicker'))}</div><h3>${esc(s.title)}</h3><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
        const evs = s.events.length ? s.events : null;
        return `<div class="kick">${esc(t('boardroom.kicker'))}</div><h3>${esc(s.title)}</h3>${s.kind === 'verdict' ? `<p class="mood">${esc(t(`mood.${s.mood}`))}</p>` : ''}<ul>${evs ? evs.map((e) => `<li>W${e.week} — ${esc(txt(e))}</li>`).join('') : `<li>${esc(t(s.kind === 'verdict' ? 'boardroom.noVerdict' : 'boardroom.quiet'))}</li>`}</ul>`;
      }, true);
    };
    card.querySelector('[data-q]').addEventListener('change', (e) => play(+e.target.value));
    play(qs[qs.length - 1]);
  },
  pitch() {
    const deck = buildPitch(state.replay, state.sel, state.idx, t);
    const card = openModal(deck.title, '', navFoot(`<button class="btn" data-md>${icon('download')} .md</button>`));
    slideshow(card, deck.slides, (s, i) => `<div class="kick">${esc(s.kicker || `${String(i + 1).padStart(2, '0')} / ${deck.slides.length}`)}</div><h3>${esc(s.title)}</h3><ul>${s.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`);
    card.querySelector('[data-md]').addEventListener('click', () => download(`${slug(snapOf(state.sel).name)}-pitch.md`, new Blob([pitchMarkdown(deck)], { type: 'text/markdown' })));
  },
  card() {
    const story = companyStory(state.replay, state.sel, state.idx, t);
    const card = openModal(t(story.kind === 'obituary' ? 'act.obituary' : 'act.story'), '<canvas class="card-preview"></canvas>', `<span class="mute small">${esc(t('share.hint'))}</span><button class="btn primary" data-png>${icon('download')} PNG</button>`);
    const canvas = card.querySelector('canvas');
    drawCard(canvas, story, C, { money: M, int: I }, colorOf(state.sel));
    card.querySelector('[data-png]').addEventListener('click', () => canvas.toBlob((b) => b && download(`${slug(story.name)}-${story.kind}.png`, b), 'image/png'));
  },
  reel() {
    const card = openModal(t('act.reel'), `<p>${esc(t('reel.about'))}</p><div class="progress"><i></i></div><p class="mute small" data-msg></p>`, `<span></span><button class="btn primary" data-rec>${icon('film')} ${esc(t('reel.record'))}</button>`);
    const bar = card.querySelector('.progress i'), msg = card.querySelector('[data-msg]'), btn = card.querySelector('[data-rec]');
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      msg.textContent = t('reel.recording');
      try {
        const blob = await recordReel(state.replay, {
          C, colors: COLORS, fmt: { money: M }, captionOf: (e) => `W${e.week} — ${txt(e)}`,
          onProgress: (p) => { bar.style.width = `${Math.round(p * 100)}%`; },
        });
        download(`agentcorp-season-${state.replay.config.seed}.webm`, blob);
        msg.textContent = t('reel.done');
      } catch (err) {
        msg.textContent = String(err.message || err);
      }
      btn.disabled = false;
    });
  },
};

/* ───────────────────────── playback & controls ───────────────────────── */
async function control(action, value, extra = {}) {
  try { await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json', 'x-agentcorp': '1' }, body: JSON.stringify({ action, value, ...extra }) }); } catch { /* offline */ }
}
function startLocalPlayback() {
  clearInterval(state.timer);
  if (state.mode === 'live' || !state.playing) return;
  state.timer = setInterval(() => {
    if (state.idx >= frames().length - 1) { state.playing = false; clearInterval(state.timer); renderTop(); return; }
    state.idx += 1;
    scheduleRender();
  }, state.speed > 0 ? 1000 / state.speed : 30);
}
function bindControls() {
  $('btn-play').addEventListener('click', () => {
    if (state.mode === 'live') { state.playing = !state.playing; control(state.playing ? 'resume' : 'pause'); renderTop(); return; }
    if (!state.playing && state.idx >= frames().length - 1) { state.idx = 0; state.lastMomentId = 0; state.raceFresh = true; state.animate = true; }
    state.playing = !state.playing;
    startLocalPlayback();
    render();
  });
  $('speed').addEventListener('change', (e) => { state.speed = Number(e.target.value); if (state.mode === 'live') control('speed', state.speed); else startLocalPlayback(); });
  $('scrubber').addEventListener('input', (e) => {
    state.idx = Number(e.target.value);
    state.follow = state.idx === frames().length - 1;
    if (state.mode !== 'live' && state.playing) { state.playing = false; clearInterval(state.timer); }
    moments.clear();
    scheduleRender();
  });
  $('btn-live').addEventListener('click', () => { state.follow = true; state.idx = frames().length - 1; scheduleRender(); });
  $('shock').addEventListener('change', (e) => { if (e.target.value) control('shock', e.target.value, { companyId: state.sel }); e.target.value = ''; });
  $('btn-download').addEventListener('click', () => {
    if (state.mode === 'live') { const a = document.createElement('a'); a.href = '/api/download'; a.download = ''; a.click(); return; }
    download(`agentcorp-replay-${state.replay.config.seed}.json`, new Blob([JSON.stringify(state.replay)], { type: 'application/json' }));
  });
  $('file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'agentcorp-replay') throw new Error(t('err.notReplay'));
      loadStatic(data);
    } catch (err) { openModal(t('ui.open'), `<p>${esc(t('err.open', { msg: err.message }))}</p>`); }
    e.target.value = '';
  });
  $('lang').addEventListener('change', (e) => setLang(e.target.value));
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').hidden) { closeModal(); return; }
  if (!state.replay || e.target.closest('input, select, textarea, button') || !$('modal').hidden) return;
  if (e.key === ' ') { e.preventDefault(); $('btn-play')?.click(); }
  else if (e.key === 'ArrowRight') { state.idx = Math.min(frames().length - 1, state.idx + 1); state.follow = state.idx === frames().length - 1; scheduleRender(); }
  else if (e.key === 'ArrowLeft') { state.idx = Math.max(0, state.idx - 1); state.follow = false; scheduleRender(); }
});
let rt;
addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => state.replay && render(), 150); });

async function setLang(l) {
  lang = LANGS.includes(l) ? l : 'en';
  store.set('agentcorp.lang', lang);
  const [dict, en] = await Promise.all([loadLocale(lang), loadLocale('en')]);
  t = makeT(dict, en, lang);
  document.documentElement.lang = lang;
  document.title = `AgentCorp — ${t('ui.titleTail')}`;
  if (state.onboarding) { state.onboarding.rerender(t, lang); return; }
  if (state.replay) { shell(); state.animate = true; state.raceFresh = true; render(); }
}

function loadStatic(replay, mode = 'static') {
  if (state.es) { state.es.close(); state.es = null; }
  Object.assign(state, { mode, replay, idx: 0, follow: false, playing: true, speed: 5, sel: null, lastMomentId: 0, animate: true, raceFresh: true });
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('week')) {
    const w = h.get('week');
    const i = w === 'end' ? replay.frames.length - 1 : replay.frames.findIndex((f) => f.week === Number(w));
    if (i >= 0) { state.idx = i; state.playing = false; state.lastMomentId = Infinity; }
  }
  if (h.has('company')) state.sel = h.get('company');
  if (h.has('channel')) state.channel = h.get('channel');
  if (h.has('static')) state.animate = false;
  shell();
  startLocalPlayback();
  render();
}

function connectLive() {
  const es = new EventSource('/api/stream');
  state.es = es;
  es.addEventListener('tick', (e) => {
    const { frame: f, events } = JSON.parse(e.data);
    const fr = frames();
    if (f.week <= fr[fr.length - 1].week) return;
    fr.push(f);
    state.replay.events.push(...events);
    if (state.follow) state.idx = fr.length - 1;
    scheduleRender();
  });
  es.addEventListener('done', (e) => { state.replay.league = JSON.parse(e.data).league; state.replay.finished = true; scheduleRender(); });
  es.addEventListener('status', (e) => {
    const st = JSON.parse(e.data);
    state.playing = !st.paused;
    state.speed = st.speed;
    if ($('speed')) $('speed').value = String([1, 2, 5, 10, 0].includes(st.speed) ? st.speed : 2);
    if (state.replay) renderTop();
  });
  es.onerror = () => { const w = $('wire'); if (w) w.textContent = t('err.disconnected'); };
}

async function boot() {
  const embedded = window.__AGENTCORP_REPLAY__;
  const explicitLanguage = embedded ? new URLSearchParams(location.hash.slice(1)).get('lang') : null;
  await setLang(detectLang(explicitLanguage || store.get('agentcorp.lang')));
  if (embedded) { loadStatic(embedded); return; }
  try {
    const status = await fetch('/api/status').then((r) => r.json());
    if (status.mode === 'setup') {
      state.onboarding = await mountOnboarding($('app'), {
        t, icon, lang, langs: LANGS, langName: (l) => LANG_NAMES[l], onLang: (l) => setLang(l),
        onStarted: () => location.reload(),
      });
      return;
    }
    const [replay, shocks] = await Promise.all([fetch('/api/replay').then((r) => r.json()), fetch('/api/shocks').then((r) => r.json()).catch(() => [])]);
    state.shocks = shocks;
    if (status.mode === 'replay') { loadStatic(replay, 'replay'); return; }
    Object.assign(state, { mode: 'live', replay, idx: replay.frames.length - 1, follow: true, playing: !status.paused, speed: status.speed, raceFresh: true });
    state.lastMomentId = lastIdOf(replay);
    shell();
    render();
    if (!replay.finished) connectLive();
  } catch {
    $('app').innerHTML = `<div class="setup"><div class="setup-head"><div class="kicker">AgentCorp</div><h1>${esc(t('err.noSim'))}</h1><p class="lede">${esc(t('err.noSimHint'))}</p></div></div>`;
  }
}
const lastIdOf = (r) => (r.events.length ? r.events[r.events.length - 1].id : 0);

boot();
