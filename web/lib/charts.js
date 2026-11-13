// SVG charts: one y-axis, thin marks, recessive grid, crosshair tooltips, optional draw-in animation.
// ctx = { C: colors, fmtY, fmtX, tip: {show, hide}, animate: bool, label }

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function niceTicks(min, max, count = 4) {
  if (max <= min) max = min + 1;
  const step0 = (max - min) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.abs(v) < step / 1e6 ? 0 : v);
  return { lo, hi, ticks };
}

export function weekTicks(max, width = 560) {
  const base = max > 80 ? 13 : max > 30 ? 8 : max > 12 ? 4 : 1;
  const step = base * Math.max(1, Math.ceil(max / base / Math.max(1, Math.floor(width / 44))));
  const t = [];
  for (let w = 0; w <= max; w += step) t.push(w);
  return t;
}

function hover(el, W, m, pw, xMax, onWeek, onLeave) {
  const svg = el.querySelector('svg');
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = (ev.clientX - box.left) * (W / box.width);
    onWeek(Math.round(((px - m.l) / pw) * xMax), ev);
  });
  hit.addEventListener('pointerleave', onLeave);
}

export function lineChart(el, o, ctx) {
  const { C } = ctx;
  const W = Math.max(280, el.clientWidth || 600), H = o.height || 220;
  const m = { l: 56, r: o.right ?? 16, t: 14, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xMax = Math.max(1, o.xMax || 1);
  const all = o.series.flatMap((s) => s.points.map((p) => p.y)).filter(Number.isFinite);
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
    ({ lo: yLo, hi: yHi, ticks } = niceTicks(Math.min(0, ...all), Math.max(1, ...all), 4));
  }
  const X = (x) => m.l + (x / xMax) * pw;
  const Y = o.log
    ? (y) => m.t + ph - ((Math.log10(Math.max(y, yLo)) - Math.log10(yLo)) / (Math.log10(yHi) - Math.log10(yLo))) * ph
    : (y) => m.t + ph - ((y - yLo) / (yHi - yLo)) * ph;
  const fy = ctx.fmtY;
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.label)}">`;
  for (const t of ticks) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 && !o.log ? C.rule2 : C.grid}"/>`;
    svg += `<text class="ax" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(fy(t))}</text>`;
  }
  for (const w of weekTicks(xMax, pw)) svg += `<text class="ax" x="${X(w)}" y="${H - 6}" text-anchor="middle">${esc(ctx.fmtX(w))}</text>`;
  for (const r of o.refLines || []) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(r.y)}" y2="${Y(r.y)}" stroke="${C.mute}" stroke-dasharray="2 4"/>`;
    svg += `<text class="ax ref" x="${m.l + 6}" y="${Y(r.y) - 6}">${esc(r.label)}</text>`;
  }
  const labels = [];
  o.series.forEach((s, si) => {
    const pts = s.points.filter((p) => Number.isFinite(p.y) && (!o.log || p.y > 0));
    if (!pts.length) return;
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p.y).toFixed(1)}`).join('');
    if (s.area) {
      const base = Y(o.log ? yLo : Math.max(yLo, 0));
      svg += `<path class="${ctx.animate ? 'fade-in' : ''}" d="${d}L${X(pts[pts.length - 1].x)},${base}L${X(pts[0].x)},${base}Z" fill="${s.color}" fill-opacity=".12"/>`;
    }
    const appearance = s.dash ? 'stroke-dasharray="4 4"' : ctx.animate ? `class="draw" pathLength="1" style="--i:${si}"` : '';
    svg += `<path ${appearance} d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round"/>`;
    const last = pts[pts.length - 1];
    svg += `<circle class="head" cx="${X(last.x)}" cy="${Y(last.y)}" r="3.5" fill="${s.color}" stroke="${C.ink}" stroke-width="2"/>`;
    if (s.endLabel) labels.push({ x: X(last.x) + 8, y: Y(last.y) + 4, text: s.endLabel });
  });
  labels.sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 14) labels[i].y = labels[i - 1].y + 14;
  for (const lb of labels) svg += `<text class="endlabel" x="${lb.x}" y="${lb.y}">${esc(lb.text)}</text>`;
  for (const mk of o.markers || []) {
    svg += `<g class="mk"><line x1="${X(mk.x)}" x2="${X(mk.x)}" y1="${Y(mk.y)}" y2="${m.t + ph}" stroke="${mk.color}" stroke-opacity=".35"/><rect x="${X(mk.x) - 4}" y="${Y(mk.y) - 4}" width="8" height="8" fill="${C.ink}" stroke="${mk.color}" stroke-width="2" transform="rotate(45 ${X(mk.x)} ${Y(mk.y)})"/>`;
    if (mk.label) svg += `<text class="mklabel" x="${X(mk.x)}" y="${Y(mk.y) - 10}" text-anchor="middle">${esc(mk.label)}</text>`;
    svg += '</g>';
  }
  svg += `<line class="xh" y1="${m.t}" y2="${m.t + ph}" stroke="${C.paper}" stroke-opacity=".4" visibility="hidden"/><g class="xd"></g>`;
  svg += `<rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
  el.innerHTML = svg;
  const xh = el.querySelector('.xh'), xd = el.querySelector('.xd');
  hover(el, W, m, pw, xMax, (wk, ev) => {
    const rows = [];
    let dots = '';
    for (const s of o.series) {
      const p = s.points.find((q) => q.x === wk);
      if (!p || !Number.isFinite(p.y)) continue;
      rows.push(`<div class="tr"><span><i style="background:${s.color}"></i>${esc(s.name)}</span><b>${esc((s.fmt || fy)(p.y))}</b></div>`);
      if (!o.log || p.y > 0) dots += `<circle cx="${X(wk)}" cy="${Y(p.y)}" r="4" fill="${s.color}" stroke="${C.ink}" stroke-width="2"/>`;
    }
    if (!rows.length) { xh.setAttribute('visibility', 'hidden'); xd.innerHTML = ''; return ctx.tip.hide(); }
    xh.setAttribute('x1', X(wk)); xh.setAttribute('x2', X(wk)); xh.setAttribute('visibility', 'visible');
    xd.innerHTML = dots;
    ctx.tip.show(`<div class="tt">${esc(ctx.fmtX(wk, true))}</div>${rows.join('')}${o.tipExtra ? o.tipExtra(wk) : ''}`, ev.clientX, ev.clientY);
  }, () => { xh.setAttribute('visibility', 'hidden'); xd.innerHTML = ''; ctx.tip.hide(); });
}

export function divergingBars(el, o, ctx) {
  const { C } = ctx;
  const W = Math.max(280, el.clientWidth || 600), H = o.height || 200;
  const m = { l: 56, r: 16, t: 10, b: 24 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const xMax = Math.max(1, o.xMax || 1);
  const { lo, hi, ticks } = niceTicks(-Math.max(1, ...o.down.map((p) => p.y)), Math.max(1, ...o.up.map((p) => p.y)), 4);
  const Y = (v) => m.t + ph - ((v - lo) / (hi - lo)) * ph;
  const bw = Math.max(1, pw / (xMax + 1) - 1.5);
  const X = (w) => m.l + (w / (xMax + 1)) * pw + 0.75;
  let svg = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(o.label)}">`;
  for (const t of ticks) {
    svg += `<line x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}" stroke="${t === 0 ? C.rule2 : C.grid}"/>`;
    svg += `<text class="ax" x="${m.l - 8}" y="${Y(t) + 4}" text-anchor="end">${esc(o.fmtCount(Math.abs(t)))}</text>`;
  }
  for (const w of weekTicks(xMax, pw)) svg += `<text class="ax" x="${X(w) + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(ctx.fmtX(w))}</text>`;
  const z = Y(0);
  svg += `<g class="${ctx.animate ? 'grow' : ''}" style="transform-origin:0 ${z}px">`;
  for (const p of o.up) if (p.y > 0) svg += `<rect x="${X(p.x)}" y="${Y(p.y)}" width="${bw}" height="${Math.max(0.5, z - Y(p.y))}" fill="${o.upColor}"/>`;
  for (const p of o.down) if (p.y > 0) svg += `<rect x="${X(p.x)}" y="${z}" width="${bw}" height="${Math.max(0.5, Y(-p.y) - z)}" fill="${o.downColor}"/>`;
  svg += `</g><rect class="hit" x="${m.l}" y="${m.t}" width="${pw}" height="${ph}" fill="transparent"/></svg>`;
  el.innerHTML = svg;
  hover(el, W, m, pw, xMax + 1, (wk, ev) => {
    const u = o.up.find((p) => p.x === wk), d = o.down.find((p) => p.x === wk);
    if (!u && !d) return ctx.tip.hide();
    ctx.tip.show(`<div class="tt">${esc(ctx.fmtX(wk, true))}</div>
      <div class="tr"><span><i style="background:${o.upColor}"></i>${esc(o.upLabel)}</span><b>+${esc(o.fmtCount(u?.y || 0))}</b></div>
      <div class="tr"><span><i style="background:${o.downColor}"></i>${esc(o.downLabel)}</span><b>−${esc(o.fmtCount(d?.y || 0))}</b></div>`, ev.clientX, ev.clientY);
  }, ctx.tip.hide);
}

export function sparkline(points, color, h = 26) {
  const pts = points.filter((p) => Number.isFinite(p.y));
  if (pts.length < 2) return `<svg class="spark" viewBox="0 0 100 ${h}" preserveAspectRatio="none"></svg>`;
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const X = (x) => ((x - x0) / Math.max(1, x1 - x0)) * 100;
  const Y = (y) => h - 3 - ((y - y0) / Math.max(1e-9, y1 - y0)) * (h - 6);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(2)},${Y(p.y).toFixed(2)}`).join('');
  return `<svg class="spark" viewBox="0 0 100 ${h}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.5" vector-effect="non-scaling-stroke"/></svg>`;
}
