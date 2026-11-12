// Share artefacts rendered on <canvas>: a 1200×630 story card (PNG) and a highlight reel (WebM video).

const SERIF = '"Iowan Old Style", "Charter", "Georgia", "Times New Roman", serif';
const MONO = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, monospace';
const SANS = 'ui-sans-serif, system-ui, "Segoe UI", Roboto, "Noto Sans", sans-serif';

function wrap(ctx, text, x, y, maxW, lh, maxLines = 3) {
  const str = String(text);
  const cjk = /[　-鿿가-힯]/.test(str);
  const tokens = cjk ? [...str] : str.split(/(\s+)/);
  let lines = [], line = '';
  for (const t of tokens) {
    if (ctx.measureText(line + t).width > maxW && line.trim()) { lines.push(line.trim()); line = t.trimStart(); }
    else line += t;
  }
  if (line.trim()) lines.push(line.trim());
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    let l = lines[maxLines - 1];
    while (ctx.measureText(`${l}…`).width > maxW && l) l = l.slice(0, -1);
    lines[maxLines - 1] = `${l}…`;
  }
  lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
  return y + lines.length * lh;
}

/** Draw the obituary / success-story card. `story` comes from story.companyStory. */
export function drawCard(canvas, story, C, fmt, accent) {
  const W = 1200, H = 630;
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d');
  const dead = story.kind === 'obituary';
  x.fillStyle = dead ? '#0b0b0a' : C.ink;
  x.fillRect(0, 0, W, H);
  // newspaper frame
  x.strokeStyle = C.paper; x.lineWidth = 2;
  x.strokeRect(40, 40, W - 80, H - 80);
  x.lineWidth = 1; x.strokeStyle = C.rule2;
  x.beginPath(); x.moveTo(40, 112); x.lineTo(W - 40, 112); x.stroke();
  x.fillStyle = dead ? C.mute : accent;
  x.font = `600 15px ${MONO}`;
  x.fillText(story.kicker.toUpperCase(), 64, 86);
  x.textAlign = 'right';
  x.fillStyle = C.mute;
  x.fillText(story.dates.toUpperCase(), W - 64, 86);
  x.textAlign = 'left';
  // headline
  x.fillStyle = C.paper;
  x.font = `600 58px ${SERIF}`;
  let y = wrap(x, story.headline, 64, 182, W - 128, 64, 2);
  x.font = `italic 22px ${SERIF}`;
  x.fillStyle = C.mute;
  y = wrap(x, `“${story.tagline}”`, 64, y + 4, W - 128, 30, 1);
  // stats band
  const top = Math.max(y + 18, 330);
  x.strokeStyle = C.rule2;
  x.beginPath(); x.moveTo(64, top); x.lineTo(W - 64, top); x.stroke();
  const colW = (W - 128) / story.stats.length;
  story.stats.forEach(([label, v, f], i) => {
    const cx = 64 + i * colW;
    x.fillStyle = C.mute; x.font = `500 13px ${MONO}`;
    x.fillText(String(label).toUpperCase(), cx, top + 30);
    x.fillStyle = C.paper; x.font = `600 38px ${MONO}`;
    x.fillText(f === 'money' ? fmt.money(v) : fmt.int(v), cx, top + 76);
    if (i) { x.strokeStyle = C.rule2; x.beginPath(); x.moveTo(cx - 16, top + 12); x.lineTo(cx - 16, top + 88); x.stroke(); }
  });
  // reasons
  x.font = `17px ${SANS}`;
  let ry = top + 128;
  for (const r of story.reasons.slice(0, 3)) {
    x.fillStyle = dead ? C.critical : accent;
    x.fillRect(64, ry - 11, 8, 8);
    x.fillStyle = C.paper;
    ry = wrap(x, r, 86, ry, W - 160, 24, 1) + 4;
  }
  // footer
  x.fillStyle = C.mute; x.font = `500 13px ${MONO}`;
  x.fillText(story.epitaph.toUpperCase(), 64, H - 58);
  x.textAlign = 'right';
  x.fillText('AGENTCORP · GITHUB.COM/BITOVVNEW/AGENTCORP', W - 64, H - 58);
  x.textAlign = 'left';
  return canvas;
}

/**
 * Render the valuation race to a video. Each season week becomes a few frames; headlines appear as captions.
 * Returns a WebM Blob. `onProgress(0..1)` is called while recording.
 */
export async function recordReel(replay, { C, colors, fmt, captionOf, seconds = 14, onProgress }) {
  if (typeof MediaRecorder === 'undefined') throw new Error('This browser cannot record video (MediaRecorder missing).');
  const W = 1280, H = 720, fps = 30;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const x = canvas.getContext('2d');
  const stream = canvas.captureStream(fps);
  const mime = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime, videoBitsPerSecond: 6_000_000 } : undefined);
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise((r) => (rec.onstop = r));
  rec.start(250);

  const frames = replay.frames;
  const last = frames.length - 1;
  const total = seconds * fps;
  const ids = replay.companies.map((c) => c.id);
  const val = (i, id) => { const s = frames[i].companies.find((c) => c.id === id); return s && s.stat.week === frames[i].week ? s.valuation : null; };
  let maxV = 1e7;
  for (const f of frames) for (const c of f.companies) maxV = Math.max(maxV, c.valuation);
  const lo = 1e6, hi = Math.pow(10, Math.ceil(Math.log10(Math.max(maxV, 1.2e9))));
  const m = { l: 110, r: 230, t: 150, b: 90 };
  const X = (w) => m.l + (w / Math.max(1, frames[last].week)) * (W - m.l - m.r);
  const Y = (v) => H - m.b - ((Math.log10(Math.max(v, lo)) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * (H - m.t - m.b);
  const caps = replay.events.filter((e) => e.importance === 3 && e.kind !== 'founded');

  for (let n = 0; n <= total; n++) {
    const pos = (n / total) * last;
    const i = Math.floor(pos);
    x.fillStyle = C.ink; x.fillRect(0, 0, W, H);
    x.fillStyle = C.paper; x.font = `600 44px ${SERIF}`;
    x.fillText(replay.config.title || 'AgentCorp', m.l, 78);
    x.font = `600 16px ${MONO}`; x.fillStyle = C.mute;
    x.fillText(`${replay.scenario.name.toUpperCase()} · SEED ${replay.config.seed}`, m.l, 108);
    x.textAlign = 'right'; x.fillStyle = C.paper; x.font = `600 64px ${MONO}`;
    x.fillText(`W${String(frames[i].week).padStart(3, '0')}`, W - 60, 92);
    x.textAlign = 'left';
    // grid
    x.strokeStyle = C.grid; x.lineWidth = 1; x.font = `13px ${MONO}`; x.fillStyle = C.mute;
    for (let v = lo; v <= hi; v *= 10) {
      x.beginPath(); x.moveTo(m.l, Y(v)); x.lineTo(W - m.r, Y(v)); x.stroke();
      x.fillText(fmt.money(v), 30, Y(v) + 4);
    }
    x.setLineDash([3, 6]); x.strokeStyle = C.mute;
    x.beginPath(); x.moveTo(m.l, Y(1e9)); x.lineTo(W - m.r, Y(1e9)); x.stroke(); x.setLineDash([]);
    // lines
    const ends = [];
    ids.forEach((id, k) => {
      x.strokeStyle = colors[replay.companies[k].color % colors.length]; x.lineWidth = 3; x.beginPath();
      let started = false, lastPt = null;
      for (let j = 1; j <= i; j++) {
        const v = val(j, id);
        if (!v) continue;
        const px = X(frames[j].week), py = Y(v);
        if (!started) { x.moveTo(px, py); started = true; } else x.lineTo(px, py);
        lastPt = [px, py, v];
      }
      x.stroke();
      if (lastPt) ends.push({ k, y: lastPt[1], px: lastPt[0], v: lastPt[2] });
    });
    ends.sort((a, b) => a.y - b.y);
    for (let e = 1; e < ends.length; e++) if (ends[e].y - ends[e - 1].y < 36) ends[e].y = ends[e - 1].y + 36;
    for (const e of ends) {
      const comp = replay.companies[e.k];
      x.fillStyle = colors[comp.color % colors.length];
      x.beginPath(); x.arc(e.px, Y(e.v), 6, 0, Math.PI * 2); x.fill();
      x.font = `600 18px ${SANS}`; x.fillStyle = C.paper;
      x.fillText(comp.name, W - m.r + 18, e.y + 2);
      x.font = `14px ${MONO}`; x.fillStyle = C.mute;
      x.fillText(`${comp.brainLabel} · ${fmt.money(e.v)}`, W - m.r + 18, e.y + 20);
    }
    // caption: most recent headline within the last 6 weeks
    const cap = [...caps].reverse().find((e) => e.week <= frames[i].week && e.week > frames[i].week - 6);
    if (cap) {
      x.fillStyle = C.paper; x.fillRect(m.l, H - 64, W - m.l - 60, 40);
      x.fillStyle = C.ink; x.font = `600 18px ${SANS}`;
      let text = captionOf(cap);
      while (x.measureText(text).width > W - m.l - 100 && text.length > 4) text = `${text.slice(0, -2)}…`;
      x.fillText(text, m.l + 14, H - 38);
    }
    onProgress?.(n / total);
    await new Promise((r) => setTimeout(r, 1000 / fps));
  }
  await new Promise((r) => setTimeout(r, 300));
  rec.stop();
  await done;
  return new Blob(chunks, { type: 'video/webm' });
}
