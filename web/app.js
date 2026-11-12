// AgentCorp dashboard — vanilla JS, no build step, no dependencies.
// Works live (SSE from `agentcorp`), on a served replay, or as a self-contained exported HTML file.

const $ = (id) => document.getElementById(id);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const COLORS = Array.from({ length: 8 }, (_, i) => css(`--series-${i + 1}`));
const C = {
  t1: css('--text-1'), t2: css('--text-2'), t3: css('--text-3'), grid: css('--grid'), border: css('--border'),
  s1: css('--surface-1'), s2: css('--surface-2'), s3: css('--surface-3'),
  good: css('--good'), warning: css('--warning'), serious: css('--serious'), critical: css('--critical'),
  seq: [css('--seq-1'), css('--seq-2'), css('--seq-3'), css('--seq-4'), css('--seq-5')],
};
const ROLE = { ceo: 'CEO', cto: 'CTO', engineer: 'Engineer', designer: 'Designer', marketer: 'Marketer', sales: 'Sales', cfo: 'CFO', support: 'Support', board: 'Board', investor: 'Investor', market: 'News', system: 'Bot' };
const CHANNELS = ['general', 'eng', 'deals', 'sales', 'hr', 'board', 'market'];
const FOCUS = { build: 'Shipping features', growth: 'Growth marketing', sales: 'Sales push', quality: 'Quality & tech debt', efficiency: 'Cutting burn' };
const SEGMENT = { smb: 'SMB SaaS', enterprise: 'Enterprise', consumer: 'Consumer', developer: 'Dev tools' };

const state = {
  replay: null,
  mode: 'live', // live | replay | static
  idx: 0,
  follow: true,
  sel: null,
  channel: 'all',
  playing: true,
  speed: 2,
  timer: null,
  es: null,
  shocks: [],
  pending: false,
};

/* ───────────────────────── formatting ───────────────────────── */
function fmtT(n, plain = false) {
  if (n === undefined || n === null || Number.isNaN(n)) return '—';
  const a = Math.abs(n), s = n < 0 ? '-' : '', p = plain ? '' : '◈';
  if (a >= 1e9) return `${s}${p}${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}${p}${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `${s}${p}${(a / 1e3).toFixed(a >= 1e5 ? 0 : 1)}K`;
  return `${s}${p}${a >= 10 ? Math.round(a) : a.toFixed(a >= 1 ? 1 : 2)}`;
}
const fmtN = (n) => Math.round(n).toLocaleString('en-US');
function fmtCompact(n) {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${(n / 1e3).toFixed(0)}K`;
  return fmtN(n);
}
const pct = (x) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(Math.abs(x) < 0.1 ? 1 : 0)}%`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function initials(name) { return String(name || '?').split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(); }
function avatarColor(name) {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${h % 360} 32% 36%)`;
}

/* ───────────────────────── data helpers ───────────────────────── */
const frames = () => state.replay.frames;
const frame = () => frames()[state.idx];
const metaOf = (id) => state.replay.companies.find((c) => c.id === id);
const colorOf = (id) => COLORS[(metaOf(id)?.color ?? 0) % COLORS.length];
const snapOf = (id, f = frame()) => f.companies.find((c) => c.id === id);

/** Points for one company across weeks 1..current, stopping when the company dies. */
function series(id, fn) {
  const out = [];
  const fr = frames();
  for (let i = 1; i <= state.idx; i++) {
    const s = fr[i].companies.find((c) => c.id === id);
    if (!s || s.stat.week !== fr[i].week) continue;
    out.push({ x: fr[i].week, y: fn(s, fr[i]) });
  }
  return out;
}

function eventsUntil(week) {
  const ev = state.replay.events;
  // events are in chronological order
  let hi = ev.length;
  while (hi > 0 && ev[hi - 1].week > week) hi--;
  return ev.slice(0, hi);
}

function founderShare(s) {
  const total = s.capTable.reduce((a, h) => a + h.shares, 0);
  const f = s.capTable.filter((h) => h.kind === 'founder').reduce((a, h) => a + h.shares, 0);
  return total ? f / total : 0;
}

function leagueRows(f = frame()) {
  const rows = f.companies.map((s) => {
    const m = metaOf(s.id);
    const active = s.employees.filter((e) => e.status === 'active').length;
    return {
      id: s.id, name: s.name, brain: m.brainLabel, status: s.status,
      valuation: s.status === 'bankrupt' ? 0 : s.valuation, arr: s.revenue * 52, customers: s.customers,
      team: active, runway: s.stat.runwayWeeks, burn: s.stat.burn, founders: founderShare(s), cash: s.cash,
      score: s.status === 'bankrupt' ? 0 : s.valuation,
    };
  });
  rows.sort((a, b) => b.score - a.score || b.arr - a.arr || b.cash - a.cash);
  return rows;
}

/* ───────────────────────── tooltip ───────────────────────── */
const tip = $('tooltip');
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.hidden = false;
  const r = tip.getBoundingClientRect();
  let left = x + 14, top = y + 14;
  if (left + r.width > innerWidth - 8) left = x - r.width - 14;
  if (top + r.height > innerHeight - 8) top = y - r.height - 14;
  tip.style.left = `${Math.max(8, left)}px`;
  tip.style.top = `${Math.max(8, top)}px`;
}
function hideTip() { tip.hidden = true; }

/* ───────────────────────── chart primitives ───────────────────────── */
function niceTicks(min, max, count = 4) {
  if (max <= min) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { lo, hi, ticks };
}

function weekTicks(maxWeek) {
  const step = maxWeek > 80 ? 13 : maxWeek > 30 ? 8 : maxWeek > 12 ? 4 : 1;
  const t = [];
  for (let w = 0; w <= maxWeek; w += step) t.push(w);
  return t;
}

/**
 * Line chart with optional areas, markers, reference lines, log scale and a crosshair tooltip.
 * One y-axis only, by design.
 */
function lineChart(el, o) {
  const W = Math.max(280, el.clientWidth || 600);
  const H = o.height || 220;
  const m = { l: 52, r: o.right ?? 18, t: 12, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xMax = Math.max(o.xMax || 1, 1);
  const all = o.series.flatMap((s) => s.points.map((p) => p.y)).filter((v) => Number.isFinite(v));
  let yLo, yHi, ticks;
  if (o.log) {
    const pos = all.filter((v) => v > 0);
    const mn = pos.length ? Math.min(...pos) : 1e6;
    const mx = Math.max(pos.length ? Math.max(...pos) : 1e7, ...(o.refLines || []).map((r) => r.y));
    yLo = Math.pow(10, Math.floor(Math.log10(mn)));
    yHi = Math.pow(10, Math.ceil(Math.log10(mx * 1.05)));
    ticks = [];
    for (let v = yLo; v <= yHi * 1.0001; v *= 10) ticks.push(v);
  } else {
    const mn = Math.min(0, ...all);
    const mx = Math.max(1, ...all, ...(o.refLines || []).map((r) => r.y));
    ({ lo: yLo, hi: yHi, ticks } = niceTicks(mn, mx, 4));
  }
  const X = (x) => m.l + (x / xMax) * pw;
  const Y = o.log
    ? (y) => m.t + ph - ((Math.log10(Math.max(y, yLo)) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo))) * ph
    : (y) => m.t + ph - ((y - yLo) / (yHi - yLo)) * ph;
  const yFmt = o.yFmt || ((v) => fmtT(v));

  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.label || 'chart')}">`;
  for (const t of ticks) {
    const y = Y(t);
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${t === 0 && !o.log ? C.border : C.grid}" stroke-width="1"/>`;
    svg += `<text x="${m.l - 8}" y="${y + 4}" text-anchor="end">${esc(yFmt(t))}</text>`;
  }
  for (const w of weekTicks(xMax)) svg += `<text x="${X(w)}" y="${H - 6}" text-anchor="middle">W${w}</text>`;
  for (const r of o.refLines || []) {
    const y = Y(r.y);
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${C.t3}" stroke-dasharray="4 4" stroke-width="1"/>`;
    svg += `<text x="${m.l + 6}" y="${y - 5}">${esc(r.label)}</text>`;
  }
  const labels = [];
  for (const s of o.series) {
    const pts = s.points.filter((p) => Number.isFinite(p.y) && (!o.log || p.y > 0));
    if (!pts.length) continue;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    if (s.area) {
      const base = Y(o.log ? yLo : Math.max(yLo, 0));
      svg += `<path d="${d}L${X(pts[pts.length - 1].x)},${base}L${X(pts[0].x)},${base}Z" fill="${s.color}" opacity=".14"/>`;
    }
    svg += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ' stroke-dasharray="5 4"' : ''}/>`;
    const last = pts[pts.length - 1];
    if (s.endDot !== false) svg += `<circle cx="${X(last.x)}" cy="${Y(last.y)}" r="3.5" fill="${s.color}" stroke="${C.s1}" stroke-width="2"/>`;
    if (s.endLabel) labels.push({ x: X(last.x) + 8, y: Y(last.y) + 4, text: s.endLabel });
  }
  // Direct labels: nudge apart so they never overlap.
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;
  for (const lb of labels) svg += `<text x="${lb.x}" y="${lb.y}" style="fill:${C.t2}">${esc(lb.text)}</text>`;
  for (const mk of o.markers || []) {
    const x = X(mk.x), y = Y(mk.y);
    svg += `<circle cx="${x}" cy="${y}" r="5" fill="${mk.color || C.t1}" stroke="${C.s1}" stroke-width="2"/>`;
    if (mk.label) svg += `<text x="${x}" y="${y - 10}" text-anchor="middle" style="fill:${C.t2}">${esc(mk.label)}</text>`;
  }
  svg += `<line class="xh" x1="0" x2="0" y1="${m.t}" y2="${m.t + ph}" stroke="${C.t3}" stroke-width="1" visibility="hidden"/>`;
  svg += `<g class="xh-dots"></g>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/>`;
  svg += `</svg>`;
  el.innerHTML = svg;

  const root = el.querySelector('svg');
  const xh = root.querySelector('.xh');
  const dots = root.querySelector('.xh-dots');
  const hit = root.querySelector('.hit');
  hit.addEventListener('mousemove', (ev) => {
    const box = root.getBoundingClientRect();
    const scale = W / box.width;
    const px = (ev.clientX - box.left) * scale;
    const wk = Math.round(((px - m.l) / pw) * xMax);
    const rows = [];
    let dotSvg = '';
    for (const s of o.series) {
      const p = s.points.find((q) => q.x === wk);
      if (!p || !Number.isFinite(p.y)) continue;
      rows.push(`<div class="row"><span><i class="sw" style="background:${s.color}"></i>${esc(s.name)}</span><span>${esc((s.fmt || yFmt)(p.y))}</span></div>`);
      if (!o.log || p.y > 0) dotSvg += `<circle cx="${X(wk)}" cy="${Y(p.y)}" r="4" fill="${s.color}" stroke="${C.s1}" stroke-width="2"/>`;
    }
    if (!rows.length) { xh.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; hideTip(); return; }
    xh.setAttribute('x1', X(wk)); xh.setAttribute('x2', X(wk)); xh.setAttribute('visibility', 'visible');
    dots.innerHTML = dotSvg;
    const extra = o.tipExtra ? o.tipExtra(wk) : '';
    showTip(`<div class="t">Week ${wk}</div>${rows.join('')}${extra}`, ev.clientX, ev.clientY);
  });
  hit.addEventListener('mouseleave', () => { xh.setAttribute('visibility', 'hidden'); dots.innerHTML = ''; hideTip(); });
}

/** Diverging weekly bars: wins above the axis, losses below. */
function divergingBars(el, o) {
  const W = Math.max(280, el.clientWidth || 600), H = o.height || 200;
  const m = { l: 52, r: 18, t: 10, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xMax = Math.max(o.xMax || 1, 1);
  const up = Math.max(1, ...o.up.map((p) => p.y));
  const down = Math.max(1, ...o.down.map((p) => p.y));
  const { lo, hi, ticks } = niceTicks(-down, up, 4);
  const Y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
  const bw = Math.max(1, pw / (xMax + 1) - 1.5);
  const X = (w) => m.l + (w / (xMax + 1)) * pw + 0.75;
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.label || 'bars')}">`;
  for (const t of ticks) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? C.border : C.grid}"/>`;
    svg += `<text x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(fmtCompact(Math.abs(t)))}</text>`;
  }
  for (const w of weekTicks(xMax)) svg += `<text x="${X(w) + bw / 2}" y="${H - 6}" text-anchor="middle">W${w}</text>`;
  const z = Y(0);
  for (const p of o.up) if (p.y > 0) svg += `<rect x="${X(p.x)}" y="${Y(p.y)}" width="${bw}" height="${Math.max(0.5, z - Y(p.y))}" rx="${bw > 5 ? 2 : 0}" fill="${o.upColor}"/>`;
  for (const p of o.down) if (p.y > 0) svg += `<rect x="${X(p.x)}" y="${z}" width="${bw}" height="${Math.max(0.5, Y(-p.y) - z)}" rx="${bw > 5 ? 2 : 0}" fill="${o.downColor}"/>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
  el.innerHTML = svg;
  const root = el.querySelector('svg');
  root.querySelector('.hit').addEventListener('mousemove', (ev) => {
    const box = root.getBoundingClientRect();
    const px = (ev.clientX - box.left) * (W / box.width);
    const wk = Math.floor(((px - m.l) / pw) * (xMax + 1));
    const u = o.up.find((p) => p.x === wk), d = o.down.find((p) => p.x === wk);
    if (!u && !d) return hideTip();
    const net = (u?.y || 0) - (d?.y || 0);
    showTip(`<div class="t">Week ${wk}</div>
      <div class="row"><span><i class="sw" style="background:${o.upColor}"></i>Won</span><span>+${fmtN(u?.y || 0)}</span></div>
      <div class="row"><span><i class="sw" style="background:${o.downColor}"></i>Churned</span><span>−${fmtN(d?.y || 0)}</span></div>
      <div class="row"><span>Net</span><span>${net >= 0 ? '+' : '−'}${fmtN(Math.abs(net))}</span></div>`, ev.clientX, ev.clientY);
  });
  root.querySelector('.hit').addEventListener('mouseleave', hideTip);
}

function sparkline(points, color, h = 28) {
  const pts = points.filter((p) => Number.isFinite(p.y));
  if (pts.length < 2) return `<svg viewBox="0 0 100 ${h}" preserveAspectRatio="none"></svg>`;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (x) => ((x - x0) / Math.max(1, x1 - x0)) * 100;
  const Y = (y) => h - 3 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (h - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join('');
  return `<svg viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/></svg>`;
}

function runwayGauge(weeks) {
  const max = 104;
  const v = Math.min(max, weeks);
  const status = weeks >= 999 ? 'good' : weeks < 13 ? 'critical' : weeks < 26 ? 'warning' : 'good';
  const col = C[status];
  const a = Math.PI * (1 - v / max);
  const r = 34, cx = 42, cy = 40;
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  const large = 0;
  return `<svg viewBox="0 0 84 46" style="height:46px;width:84px" aria-hidden="true">
    <path d="M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}" fill="none" stroke="${C.s3}" stroke-width="7" stroke-linecap="round"/>
    ${v > 0 ? `<path d="M${cx - r},${cy} A${r},${r} 0 ${large} 1 ${x.toFixed(2)},${y.toFixed(2)}" fill="none" stroke="${col}" stroke-width="7" stroke-linecap="round"/>` : ''}
  </svg>`;
}

/* ───────────────────────── renderers ───────────────────────── */
function renderTop() {
  const r = state.replay;
  const f = frame();
  const last = frames().length - 1;
  $('week-now').textContent = `Week ${f.week}`;
  $('week-total').textContent = `/ ${r.config.weeks}`;
  $('subtitle').textContent = `${r.config.title || 'League'} · ${r.scenario.name} · seed ${r.config.seed}`;
  const sc = $('scrubber');
  sc.max = String(last);
  sc.value = String(state.idx);
  const live = state.mode === 'live';
  $('btn-live').hidden = !live;
  $('btn-live').classList.toggle('live-on', live && state.follow);
  $('shock').hidden = !live || r.finished;
  const finished = r.finished && (state.mode !== 'live' || true);
  const atEnd = state.idx >= last;
  $('btn-play').textContent = state.playing && !(finished && atEnd && state.mode !== 'live') ? '⏸ Pause' : '▶ Play';
}

function renderTicker() {
  const f = frame();
  const ev = eventsUntil(f.week).filter((e) => !e.companyId && (e.kind === 'market' || e.kind === 'shock'));
  const latest = ev[ev.length - 1];
  $('ticker-text').textContent = latest ? `W${latest.week} · ${latest.text}` : 'Markets are calm. For now.';
  const cl = f.market.climate;
  const label = cl < 0.7 ? '🥶 Funding winter' : cl < 0.95 ? '🌥️ Cautious investors' : cl < 1.2 ? '🌤️ Normal market' : '🔥 Hot market';
  $('climate').textContent = `${label} · climate ${cl.toFixed(2)}×`;
}

function renderBanner() {
  const b = $('banner');
  const r = state.replay;
  if (r.finished && state.idx === frames().length - 1) {
    const rows = leagueRows();
    const w = rows[0];
    const unicorns = rows.filter((x) => x.status === 'unicorn').length;
    const dead = rows.filter((x) => x.status === 'bankrupt').length;
    b.innerHTML = `🏁 <strong>Season over.</strong> ${esc(w.name)} <span class="muted">(${esc(w.brain)})</span> wins at <strong>${fmtT(w.valuation)}</strong>. ${unicorns} unicorn${unicorns === 1 ? '' : 's'}, ${dead} shut down.`;
    b.hidden = false;
  } else b.hidden = true;
}

function statusBadge(status, runway) {
  if (status === 'unicorn') return '<span class="badge unicorn">🦄 Unicorn</span>';
  if (status === 'bankrupt') return '<span class="badge critical">✖ Shut down</span>';
  if (runway < 13) return '<span class="badge critical">⚠ Runway &lt; 3 mo</span>';
  if (runway < 26) return '<span class="badge warning">◔ Runway &lt; 6 mo</span>';
  if (runway >= 999) return '<span class="badge good">✓ Profitable</span>';
  return '<span class="badge good">✓ Operating</span>';
}

function renderLeague() {
  const rows = leagueRows();
  let html = `<thead><tr><th></th><th>Company</th><th>Status</th><th class="n">Valuation</th><th class="n">ARR</th><th class="n">Customers</th><th class="n">Team</th><th class="n">Runway</th><th class="n">Founders</th></tr></thead><tbody>`;
  rows.forEach((r, i) => {
    const col = colorOf(r.id);
    const runway = r.status === 'bankrupt' ? '—' : r.runway >= 999 ? '∞' : `${r.runway} wk`;
    html += `<tr class="row${r.id === state.sel ? ' sel' : ''}${r.status === 'bankrupt' ? ' dead' : ''}" data-id="${r.id}" tabindex="0" style="--sel-color:${col}">
      <td class="rank">${i + 1}</td>
      <td><div class="co"><span class="dot" style="background:${col}"></span><div><div class="co-name">${esc(r.name)}</div><div class="co-brain">${esc(r.brain)}</div></div></div></td>
      <td>${statusBadge(r.status, r.runway)}</td>
      <td class="n">${r.status === 'bankrupt' ? '—' : fmtT(r.valuation)}</td>
      <td class="n">${fmtT(r.arr)}</td>
      <td class="n">${fmtN(r.customers)}</td>
      <td class="n">${r.team}</td>
      <td class="n">${runway}</td>
      <td class="n">${Math.round(r.founders * 100)}%</td></tr>`;
  });
  $('league').innerHTML = html + '</tbody>';
  $('league').querySelectorAll('tr.row').forEach((tr) => {
    const go = () => { state.sel = tr.dataset.id; render(); };
    tr.addEventListener('click', go);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
}

function renderLeagueChart() {
  const r = state.replay;
  const ids = r.companies.map((c) => c.id);
  const series = ids.map((id) => {
    const m = metaOf(id);
    const pts = series_(id, (s) => s.valuation);
    const snap = snapOf(id);
    return { name: m.name, color: colorOf(id), points: pts, endLabel: ids.length <= 4 ? `${m.name}${snap.status === 'bankrupt' ? ' ✖' : ''}` : undefined };
  });
  lineChart($('chart-league'), {
    series, log: true, xMax: r.config.weeks, height: 250, right: ids.length <= 4 ? 96 : 18,
    refLines: [{ y: 1e9, label: '🦄 ◈1B unicorn line' }], label: 'Valuation by company over time',
  });
  $('legend-league').innerHTML = r.companies.map((c) => `<span class="key"><i class="sw" style="background:${colorOf(c.id)}"></i>${esc(c.name)} <span class="muted">· ${esc(c.brainLabel)}</span></span>`).join('');
}
const series_ = (id, fn) => series(id, fn);

function renderTabs() {
  const r = state.replay;
  $('tabs').innerHTML = r.companies.map((c) => {
    const s = snapOf(c.id);
    return `<button class="tab" role="tab" aria-selected="${c.id === state.sel}" data-id="${c.id}" style="--tab-color:${colorOf(c.id)}">
      <span class="dot" style="background:${colorOf(c.id)}"></span>${esc(c.name)} <span class="co-brain">${esc(c.brainLabel)}${s.status === 'bankrupt' ? ' · ✖' : s.status === 'unicorn' ? ' · 🦄' : ''}</span></button>`;
  }).join('');
  $('tabs').querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => { state.sel = b.dataset.id; render(); }));
}

function renderCompanyHead() {
  const id = state.sel, m = metaOf(id), s = snapOf(id), col = colorOf(id);
  const memos = eventsUntil(frame().week).filter((e) => e.companyId === id && e.kind === 'memo');
  const memo = memos[memos.length - 1];
  const ceo = s.employees.find((e) => e.role === 'ceo' && e.status === 'active');
  $('company-head').innerHTML = `
    <div>
      <div class="ch-title"><span class="dot" style="background:${col};width:14px;height:14px"></span><h1>${esc(s.name)}</h1>${statusBadge(s.status, s.stat.runwayWeeks)}</div>
      <div class="ch-tag">${esc(m.tagline)}</div>
      <div class="chips">
        <span class="chip">🧠 CEO brain: <b>${esc(m.brainLabel)}</b></span>
        <span class="chip">👤 ${esc(ceo ? ceo.name : m.ceoName)}</span>
        <span class="chip">🏷️ ${esc(SEGMENT[s.product.segment] || s.product.segment)}</span>
        <span class="chip">🎯 ${esc(FOCUS[s.focus] || s.focus)}</span>
        <span class="chip">💲 ${fmtT(s.product.price)}/customer/wk</span>
        ${s.llmTokens ? `<span class="chip">🔤 ${fmtCompact(s.llmTokens)} LLM tokens</span>` : ''}
      </div>
    </div>
    <div class="memo" style="--memo-color:${col}">
      ${memo ? `<q>${esc(memo.text)}</q><div class="who">— ${esc(memo.author || 'CEO')}, CEO memo, week ${memo.week}</div>` : '<span class="muted">No memo yet.</span>'}
    </div>`;
}

function kpi(label, value, delta, spark, extra = '') {
  return `<div class="kpi"><div class="label">${label}</div><div class="value">${value}</div><div class="delta">${delta}</div>${extra}${spark || ''}</div>`;
}
function deltaSpan(now, then, isPct = true) {
  if (then === undefined || then === null) return '<span class="muted">—</span>';
  if (isPct) {
    if (!then) return now ? '<span class="up">new</span>' : '<span class="muted">flat</span>';
    const d = now / then - 1;
    if (Math.abs(d) < 0.005) return '<span class="muted">flat</span> <span class="muted">vs 4 wk</span>';
    return `<span class="${d > 0 ? 'up' : 'down'}">${pct(d)}</span> <span class="muted">vs 4 wk</span>`;
  }
  const d = now - then;
  if (!d) return '<span class="muted">no change vs 4 wk</span>';
  return `<span class="${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : ''}${fmtN(d)}</span> <span class="muted">vs 4 wk</span>`;
}

function renderKpis() {
  const id = state.sel, s = snapOf(id), col = colorOf(id);
  const st = s.stat;
  const back = frames()[Math.max(0, state.idx - 4)];
  const sb = snapOf(id, back);
  const pb = sb ? sb.stat : undefined;
  const sp = (fn) => sparkline(series(id, fn).slice(-26), col);
  const runway = st.runwayWeeks;
  const runwayText = s.status === 'bankrupt' ? '—' : runway >= 999 ? '∞' : `${runway} wk`;
  const runwayStatus = s.status === 'bankrupt' ? '<span class="muted">company closed</span>' : runway >= 999 ? '<span>✓ profitable</span>' : runway < 13 ? '<span>⚠ critical</span>' : runway < 26 ? '<span>◔ tight</span>' : '<span>✓ healthy</span>';
  const burnText = st.burn > 0 ? fmtT(st.burn) : `+${fmtT(-st.burn)}`;
  const active = s.employees.filter((e) => e.status === 'active').length;
  const activeBack = sb ? sb.employees.filter((e) => e.status === 'active').length : undefined;
  $('kpis').innerHTML = [
    kpi('Cash', fmtT(s.cash), deltaSpan(s.cash, pb?.cash), sp((x) => x.cash)),
    kpi('Runway', runwayText, runwayStatus, '', s.status === 'bankrupt' ? '' : runwayGauge(runway)),
    kpi('Revenue / wk', fmtT(st.revenue), `ARR ${fmtT(st.revenue * 52)} · ${deltaSpan(st.revenue, pb?.revenue)}`, sp((x) => x.stat.revenue)),
    kpi(st.burn > 0 ? 'Net burn / wk' : 'Net profit / wk', burnText, `costs ${fmtT(st.costs)}/wk`, sp((x) => -x.stat.burn)),
    kpi('Customers', fmtN(s.customers), `+${fmtN(st.newCustomers)} won · −${fmtN(st.churned)} lost`, sp((x) => x.customers)),
    kpi('Team', String(active), deltaSpan(active, activeBack, false), sp((x) => x.employees.filter((e) => e.status === 'active').length)),
    kpi('Valuation', s.status === 'bankrupt' ? '—' : fmtT(s.valuation), deltaSpan(s.valuation, pb?.valuation), sp((x) => x.valuation)),
    kpi('Product quality', `${Math.round(s.product.quality)}<span class="muted" style="font-size:14px">/100</span>`, `tech debt ${Math.round(s.product.techDebt)} · ${Math.round(s.product.features)} features`, sp((x) => x.product.quality)),
  ].join('');
}

function renderCash() {
  const id = state.sel, s = snapOf(id), col = colorOf(id);
  const pts = series(id, (x) => x.cash);
  const markers = s.rounds.filter((r) => r.week > 0 && r.week <= frame().week).map((r) => {
    const p = pts.find((q) => q.x === r.week);
    return p ? { x: r.week, y: p.y, label: r.name.replace('Series ', '').replace('Growth round', 'Growth'), color: col } : null;
  }).filter(Boolean);
  lineChart($('chart-cash'), {
    series: [{ name: 'Cash', color: col, points: pts, area: true }],
    markers, xMax: state.replay.config.weeks, height: 220, label: 'Cash over time',
    tipExtra: (wk) => {
      const r = s.rounds.find((x) => x.week === wk);
      return r ? `<div class="row"><span>💰 ${esc(r.name)}</span><span>${fmtT(r.amount)}</span></div><div class="muted">${esc(r.investor)} · pre ${fmtT(r.preMoney)}</div>` : '';
    },
  });
}

function renderPnl() {
  const id = state.sel, col = colorOf(id);
  lineChart($('chart-pnl'), {
    series: [
      { name: 'Revenue', color: col, points: series(id, (x) => x.stat.revenue) },
      { name: 'Costs', color: C.t2, points: series(id, (x) => x.stat.costs), dash: true, width: 1.6 },
    ],
    xMax: state.replay.config.weeks, height: 220, label: 'Weekly revenue and costs',
  });
  $('legend-pnl').innerHTML = `<span class="key"><i class="sw" style="background:${col}"></i>Revenue</span><span class="key"><i class="sw dash"></i>Costs</span>`;
}

function renderCustomers() {
  const id = state.sel, col = colorOf(id);
  divergingBars($('chart-cust'), {
    up: series(id, (x) => x.stat.newCustomers), down: series(id, (x) => x.stat.churned),
    upColor: col, downColor: C.t3, xMax: state.replay.config.weeks, height: 200, label: 'Customers won and churned per week',
  });
  $('legend-cust').innerHTML = `<span class="key"><i class="sw box" style="background:${col}"></i>Won</span><span class="key"><i class="sw box" style="background:${C.t3}"></i>Churned</span>`;
}

function renderSpend() {
  const s = snapOf(state.sel);
  const st = s.stat;
  const parts = [
    ['Payroll', st.payroll], ['Marketing', st.marketing], ['Infra & office', st.infra], ['Bounties', st.bounties], ['LLM tokens', st.aiSpend],
  ].filter(([, v]) => v > 0);
  const total = parts.reduce((a, [, v]) => a + v, 0) || 1;
  $('spend-note').textContent = `week ${st.week} · ${fmtT(st.costs)} total`;
  $('spend').innerHTML = `<div class="stack" role="img" aria-label="Spending breakdown">${parts.map(([n, v], i) => `<div style="flex:${v};background:${C.seq[i % 5]}" title="${esc(n)}: ${fmtT(v)}"></div>`).join('')}</div>
    <div class="stack-list">${parts.map(([n, v], i) => `<i class="sw box" style="width:10px;height:10px;border-radius:3px;background:${C.seq[i % 5]}"></i><span class="nm">${esc(n)}</span><span class="v">${fmtT(v)}</span><span class="p">${Math.round((v / total) * 100)}%</span>`).join('')}</div>`;
}

function renderCapTable() {
  const s = snapOf(state.sel), col = colorOf(state.sel);
  const total = s.capTable.reduce((a, h) => a + h.shares, 0) || 1;
  const inv = s.capTable.filter((h) => h.kind === 'investor');
  const grays = ['#b5b4ab', '#9a998f', '#807f77', '#6a6a63', '#57574f', '#47473f'];
  const color = (h) => (h.kind === 'founder' ? col : h.kind === 'pool' ? C.s3 : grays[inv.indexOf(h) % grays.length]);
  $('cap-note').textContent = `${s.rounds.length} round${s.rounds.length === 1 ? '' : 's'} · founders own ${Math.round(founderShare(s) * 100)}%`;
  $('captable').innerHTML = `<div class="stack" role="img" aria-label="Ownership">${s.capTable.map((h) => `<div class="${h.kind === 'pool' ? 'hatch' : ''}" style="flex:${h.shares};background-color:${color(h)}" title="${esc(h.name)}: ${((h.shares / total) * 100).toFixed(1)}%"></div>`).join('')}</div>
    <div class="stack-list">${s.capTable.map((h) => `<i class="sw box ${h.kind === 'pool' ? 'hatch' : ''}" style="width:10px;height:10px;border-radius:3px;background-color:${color(h)}"></i><span class="nm">${esc(h.name)}</span><span class="v">${fmtCompact(h.shares)}</span><span class="p">${((h.shares / total) * 100).toFixed(1)}%</span>`).join('')}</div>`;
}

const DEPTS = [
  { name: 'Leadership', roles: ['cto', 'cfo'] },
  { name: 'Engineering', roles: ['engineer', 'designer'] },
  { name: 'Go-to-market', roles: ['marketer', 'sales'] },
  { name: 'Support', roles: ['support'] },
];
function ringFor(perf) {
  if (perf >= 1.05) return C.good;
  if (perf < 0.6) return C.critical;
  if (perf < 0.75) return C.warning;
  return 'transparent';
}
function personChip(e, opts = {}) {
  const title = `${e.level === 3 ? 'Senior ' : e.level === 1 ? 'Junior ' : ''}${ROLE[e.role]}`;
  const gone = e.status !== 'active';
  const cls = `person${gone ? ' gone' : ''}${opts.big ? ' big' : ''}${opts.mini ? ' mini' : ''}`;
  const data = esc(JSON.stringify({ n: e.name, t: title, s: e.salary, p: e.performance, m: e.morale, k: e.tasksDone, $: e.earned, h: e.hiredWeek, st: e.status, l: e.leftWeek }));
  return `<span class="${cls}" data-p="${data}" style="--ring:${gone ? 'transparent' : ringFor(e.performance)}"><span class="av" style="background:${avatarColor(e.name)}">${opts.mini ? '' : initials(e.name)}</span>${opts.mini ? '' : `<span class="pn">${esc(e.name.split(' ')[0])}${opts.big ? ` · ${esc(title)}` : ''}</span>`}</span>`;
}

function renderOrg() {
  const s = snapOf(state.sel);
  const ceo = s.employees.find((e) => e.role === 'ceo' && e.status === 'active') || s.employees.find((e) => e.role === 'ceo');
  const active = s.employees.filter((e) => e.status === 'active');
  const gone = s.employees.filter((e) => e.status !== 'active');
  $('org-note').textContent = `${active.length} people · payroll ${fmtT(active.reduce((a, e) => a + e.salary, 0))}/wk${gone.length ? ` · ${gone.length} left recently` : ''}`;
  let html = `<div class="org"><div class="org-ceo">${ceo ? personChip(ceo, { big: true }) : ''}</div><div class="depts">`;
  for (const d of DEPTS) {
    const people = s.employees.filter((e) => d.roles.includes(e.role) && (e.status === 'active' || e.leftWeek >= frame().week - 6));
    const n = people.filter((e) => e.status === 'active').length;
    if (!people.length && d.name !== 'Engineering') continue;
    const mini = people.length > 36;
    const sorted = [...people].sort((a, b) => d.roles.indexOf(a.role) - d.roles.indexOf(b.role) || (a.status === 'active' ? -1 : 1));
    html += `<div class="dept"><h3><span>${d.name}</span><span>${n}</span></h3><div class="people">${sorted.map((e) => personChip(e, { mini })).join('') || '<span class="muted small">nobody yet</span>'}</div></div>`;
  }
  html += `</div><div class="org-legend"><span><i class="ring" style="border-color:${C.good}"></i>star performer</span><span><i class="ring" style="border-color:${C.warning}"></i>at risk</span><span><i class="ring" style="border-color:${C.critical}"></i>on a performance plan</span><span><s>name</s> left recently</span></div></div>`;
  $('org').innerHTML = html;
  $('org').querySelectorAll('.person').forEach((el) => {
    el.addEventListener('mousemove', (ev) => {
      const p = JSON.parse(el.dataset.p);
      showTip(`<div class="t">${esc(p.n)}</div><div class="muted">${esc(p.t)} · hired W${p.h}${p.st !== 'active' ? ` · ${p.st} W${p.l}` : ''}</div>
        <div class="row"><span>Salary</span><span>${fmtT(p.s)}/wk</span></div>
        <div class="row"><span>Performance</span><span>${p.p.toFixed(2)}</span></div>
        <div class="row"><span>Morale</span><span>${Math.round(p.m * 100)}%</span></div>
        <div class="row"><span>Bounties won</span><span>${p.k} · ${fmtT(p.$)}</span></div>`, ev.clientX, ev.clientY);
    });
    el.addEventListener('mouseleave', hideTip);
  });
}

function renderChat() {
  const id = state.sel;
  const all = eventsUntil(frame().week).filter((e) => e.companyId === id || !e.companyId);
  const counts = {};
  for (const e of all) counts[e.channel] = (counts[e.channel] || 0) + 1;
  $('channels').innerHTML = [['all', all.length], ...CHANNELS.filter((c) => counts[c]).map((c) => [c, counts[c]])]
    .map(([c, n]) => `<li><button aria-pressed="${state.channel === c}" data-c="${c}"><span>${c === 'all' ? 'All channels' : `#${c}`}</span><span class="cnt">${fmtCompact(n)}</span></button></li>`).join('');
  $('channels').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { state.channel = b.dataset.c; renderChat(); }));
  const list = (state.channel === 'all' ? all : all.filter((e) => e.channel === state.channel)).slice(-160);
  $('chat-note').textContent = `${fmtN(all.length)} messages`;
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  box.innerHTML = list.length ? list.map((e) => {
    const who = e.author || 'System';
    const role = ROLE[e.authorRole] || '';
    const bg = e.authorRole === 'ceo' ? colorOf(id) : e.authorRole === 'market' ? C.s3 : avatarColor(who);
    return `<li class="msg${e.importance === 3 ? ' big' : ''}"><span class="av" style="background:${bg}">${e.authorRole === 'market' ? '📰' : e.authorRole === 'board' ? '🏛' : initials(who)}</span>
      <div><div class="meta"><b>${esc(who)}</b>${role ? `<span class="role">${esc(role)}</span>` : ''}<span>#${esc(e.channel)} · W${e.week}</span></div><div class="text">${esc(e.text)}</div></div></li>`;
  }).join('') : '<li class="empty">Quiet in here.</li>';
  if (nearBottom || state.follow) box.scrollTop = box.scrollHeight;
}

const LANES = [
  { name: 'Funding', kinds: ['raise', 'bridge', 'raise_rejected'] },
  { name: 'People', kinds: ['hire', 'fire', 'quit', 'ceo_ousted'] },
  { name: 'Product', kinds: ['ship', 'pivot', 'price'] },
  { name: 'Board', kinds: ['board', 'review'] },
  { name: 'Milestones', kinds: ['milestone', 'unicorn', 'bankrupt', 'brain_error'] },
  { name: 'Market', kinds: ['market', 'shock'] },
];
const BAD = new Set(['fire', 'quit', 'ceo_ousted', 'bankrupt', 'raise_rejected', 'brain_error']);
const GOOD = new Set(['raise', 'unicorn', 'milestone']);

function renderTimeline() {
  const el = $('timeline');
  const id = state.sel, col = colorOf(id);
  const weeks = state.replay.config.weeks;
  const W = Math.max(320, el.clientWidth || 800), laneH = 28, m = { l: 92, r: 18, t: 8, b: 22 };
  const H = m.t + LANES.length * laneH + m.b;
  const pw = W - m.l - m.r;
  const X = (w) => m.l + (w / Math.max(1, weeks)) * pw;
  const evs = eventsUntil(frame().week).filter((e) => e.companyId === id || (!e.companyId && e.kind !== 'milestone'));
  const buckets = new Map();
  for (const e of evs) {
    const lane = LANES.findIndex((l) => l.kinds.includes(e.kind));
    if (lane < 0) continue;
    const k = `${lane}:${e.week}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(e);
  }
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Decision timeline">`;
  LANES.forEach((l, i) => {
    const y = m.t + i * laneH + laneH / 2;
    svg += `<text x="0" y="${y + 4}" style="fill:${C.t2}">${l.name}</text><line x1="${m.l}" x2="${W - m.r}" y1="${y}" y2="${y}" stroke="${C.grid}"/>`;
  });
  for (const w of weekTicks(weeks)) svg += `<text x="${X(w)}" y="${H - 5}" text-anchor="middle">W${w}</text>`;
  for (const [k, list] of buckets) {
    const [lane, wk] = k.split(':').map(Number);
    const y = m.t + lane * laneH + laneH / 2;
    const top = list.reduce((a, e) => (e.importance > a.importance ? e : a), list[0]);
    const onlyHires = list.every((e) => e.kind === 'hire');
    const fill = LANES[lane].name === 'Market' || onlyHires ? C.t3 : BAD.has(top.kind) ? C.critical : GOOD.has(top.kind) ? C.good : col;
    const r = onlyHires ? 2.5 : Math.min(8, 3 + top.importance + Math.log2(list.length));
    svg += `<circle data-k="${k}" cx="${X(wk)}" cy="${y}" r="${r}" fill="${fill}" stroke="${C.s1}" stroke-width="1.5" style="cursor:default"/>`;
  }
  svg += `<line x1="${X(frame().week)}" x2="${X(frame().week)}" y1="${m.t}" y2="${H - m.b}" stroke="${C.t3}" stroke-dasharray="3 3"/></svg>`;
  el.innerHTML = svg;
  el.querySelectorAll('circle[data-k]').forEach((c) => {
    c.addEventListener('mousemove', (ev) => {
      const list = buckets.get(c.dataset.k) || [];
      const shown = list.slice(0, 6).map((e) => `<div style="margin-top:3px">${esc(e.text)}</div>`).join('');
      showTip(`<div class="t">Week ${list[0]?.week} · ${LANES[Number(c.dataset.k.split(':')[0])].name}</div>${shown}${list.length > 6 ? `<div class="muted">+${list.length - 6} more</div>` : ''}`, ev.clientX, ev.clientY);
    });
    c.addEventListener('mouseleave', hideTip);
  });
}

function renderBounties() {
  const id = state.sel;
  const list = eventsUntil(frame().week).filter((e) => e.companyId === id && (e.kind === 'bounty' || e.kind === 'ship')).slice(-14).reverse();
  $('bounties').innerHTML = list.length ? list.map((e) => `<li><span class="wk">W${e.week}</span><span>${esc(e.text)}</span></li>`).join('') : '<li class="empty">No bounties yet.</li>';
  const s = snapOf(id);
  const top = [...s.employees].filter((e) => e.earned > 0).sort((a, b) => b.earned - a.earned).slice(0, 7);
  const max = top[0]?.earned || 1;
  const col = colorOf(id);
  $('earners').innerHTML = top.length ? `<div class="earn">${top.map((e) => `<div><div>${esc(e.name)} <span class="muted small">${ROLE[e.role]}${e.status !== 'active' ? ` · ${e.status}` : ''}</span></div><div class="bar" style="width:${Math.max(3, (e.earned / max) * 100)}%;background:${col}"></div></div><span class="v muted">${e.tasksDone} tasks</span><span class="v">${fmtT(e.earned)}</span>`).join('')}</div>` : '<div class="empty">Nobody has won a bounty yet.</div>';
}

function render() {
  state.pending = false;
  if (!state.replay) return;
  if (!state.sel || !metaOf(state.sel)) state.sel = leagueRows()[0]?.id || state.replay.companies[0].id;
  renderTop();
  renderTicker();
  renderBanner();
  renderLeague();
  renderLeagueChart();
  renderTabs();
  renderCompanyHead();
  renderKpis();
  renderCash();
  renderPnl();
  renderCustomers();
  renderSpend();
  renderCapTable();
  renderOrg();
  renderChat();
  renderTimeline();
  renderBounties();
}
function scheduleRender() {
  if (state.pending) return;
  state.pending = true;
  requestAnimationFrame(render);
}

/* ───────────────────────── playback & controls ───────────────────────── */
async function control(action, value, extra = {}) {
  try {
    await fetch('/api/control', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, value, ...extra }) });
  } catch { /* offline */ }
}

function startLocalPlayback() {
  clearInterval(state.timer);
  if (state.mode === 'live' || !state.playing) return;
  const ms = state.speed > 0 ? 1000 / state.speed : 30;
  state.timer = setInterval(() => {
    if (state.idx >= frames().length - 1) { state.playing = false; clearInterval(state.timer); renderTop(); return; }
    state.idx += 1;
    scheduleRender();
  }, ms);
}

function bindControls() {
  $('btn-play').addEventListener('click', () => {
    if (state.mode === 'live') {
      state.playing = !state.playing;
      control(state.playing ? 'resume' : 'pause');
      renderTop();
      return;
    }
    if (!state.playing && state.idx >= frames().length - 1) state.idx = 0;
    state.playing = !state.playing;
    startLocalPlayback();
    render();
  });
  $('speed').addEventListener('change', (e) => {
    state.speed = Number(e.target.value);
    if (state.mode === 'live') control('speed', state.speed);
    else startLocalPlayback();
  });
  $('scrubber').addEventListener('input', (e) => {
    state.idx = Number(e.target.value);
    state.follow = state.idx === frames().length - 1;
    if (state.mode !== 'live' && state.playing) { state.playing = false; clearInterval(state.timer); }
    scheduleRender();
  });
  $('btn-live').addEventListener('click', () => { state.follow = true; state.idx = frames().length - 1; scheduleRender(); });
  $('shock').addEventListener('change', (e) => {
    const v = e.target.value;
    if (v) control('shock', v, { companyId: state.sel });
    e.target.value = '';
  });
  $('btn-download').addEventListener('click', () => {
    if (state.mode === 'live') { const a = document.createElement('a'); a.href = '/api/download'; a.download = ''; a.click(); return; }
    const blob = new Blob([JSON.stringify(state.replay)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agentcorp-replay-${state.replay.config.seed}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== 'agentcorp-replay') throw new Error('not an AgentCorp replay');
      loadStatic(data);
    } catch (err) {
      alert(`Could not open replay: ${err.message}`);
    }
    e.target.value = '';
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, select, textarea')) return;
    if (e.key === ' ') { e.preventDefault(); $('btn-play').click(); }
    else if (e.key === 'ArrowRight') { state.idx = Math.min(frames().length - 1, state.idx + 1); state.follow = state.idx === frames().length - 1; scheduleRender(); }
    else if (e.key === 'ArrowLeft') { state.idx = Math.max(0, state.idx - 1); state.follow = false; scheduleRender(); }
  });
  let rt;
  addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(render, 120); });
}

function loadStatic(replay, mode = 'static') {
  if (state.es) { state.es.close(); state.es = null; }
  state.mode = mode;
  state.replay = replay;
  state.idx = 0;
  state.follow = false;
  state.playing = true;
  state.speed = 6;
  state.sel = null;
  $('speed').value = '5';
  state.speed = 5;
  // Deep links: #week=52&company=c2 (week=end jumps to the final week, no autoplay).
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.has('week')) {
    const w = h.get('week');
    const i = w === 'end' ? replay.frames.length - 1 : replay.frames.findIndex((f) => f.week === Number(w));
    if (i >= 0) { state.idx = i; state.playing = false; }
  }
  if (h.has('company')) state.sel = h.get('company');
  if (h.has('channel')) state.channel = h.get('channel');
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
  es.addEventListener('done', (e) => {
    const { league } = JSON.parse(e.data);
    state.replay.league = league;
    state.replay.finished = true;
    scheduleRender();
  });
  es.addEventListener('status', (e) => {
    const st = JSON.parse(e.data);
    state.playing = !st.paused;
    state.speed = st.speed;
    $('speed').value = String([1, 2, 5, 10, 0].includes(st.speed) ? st.speed : 2);
    renderTop();
  });
  es.onerror = () => { $('ticker-text').textContent = 'Disconnected from the simulation. Is agentcorp still running?'; };
}

async function boot() {
  bindControls();
  const embedded = window.__AGENTCORP_REPLAY__;
  if (embedded) { loadStatic(embedded); return; }
  try {
    const [replay, status, shocks] = await Promise.all([
      fetch('/api/replay').then((r) => r.json()),
      fetch('/api/status').then((r) => r.json()),
      fetch('/api/shocks').then((r) => r.json()).catch(() => []),
    ]);
    if (!replay) throw new Error('no data');
    state.shocks = shocks;
    $('shock').innerHTML = '<option value="">⚡ Shock…</option>' + shocks.map((s) => `<option value="${s.id}">${esc(s.label)}</option>`).join('');
    if (status.mode === 'replay') { loadStatic(replay, 'replay'); return; }
    state.mode = 'live';
    state.replay = replay;
    state.idx = replay.frames.length - 1;
    state.follow = true;
    state.playing = !status.paused;
    state.speed = status.speed;
    $('speed').value = String([1, 2, 5, 10, 0].includes(status.speed) ? status.speed : 2);
    render();
    if (!replay.finished) connectLive();
  } catch {
    $('ticker-text').textContent = 'No simulation found. Start one with: npx agentcorp — or open a replay file (⤒ Open).';
  }
}

boot();
