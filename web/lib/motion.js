// Motion primitives. Everything animates transform/opacity or a single attribute, and everything
// collapses to an instant update under prefers-reduced-motion.

export const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const ease = (t) => 1 - Math.pow(1 - t, 3);
const running = new WeakMap();

/** Tween the number inside `el` from its last value to `to`, formatting each frame. */
export function tweenNumber(el, to, format, ms = 520) {
  const from = Number(el.dataset.v ?? to);
  el.dataset.v = String(to);
  if (reduced() || from === to || !Number.isFinite(from)) { el.textContent = format(to); return; }
  const start = performance.now();
  const id = {};
  running.set(el, id);
  const step = (now) => {
    if (running.get(el) !== id) return;
    const k = Math.min(1, (now - start) / ms);
    el.textContent = format(from + (to - from) * ease(k));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  if (Math.sign(to - from) !== 0) {
    el.classList.remove('tick-up', 'tick-down');
    void el.offsetWidth;
    el.classList.add(to > from ? 'tick-up' : 'tick-down');
  }
}

/** Queue of full-width "moments" (funding rounds, deaths, unicorns) that play one at a time. */
export function momentQueue(host) {
  const q = [];
  let busy = false;
  const next = () => {
    if (busy || !q.length) return;
    busy = true;
    const { html, tone, ms } = q.shift();
    const el = document.createElement('div');
    el.className = `moment ${tone || ''}`;
    el.innerHTML = html;
    host.appendChild(el);
    const life = reduced() ? 1800 : ms || 2600;
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => el.classList.add('out'), life);
    setTimeout(() => { el.remove(); busy = false; next(); }, life + 450);
  };
  return {
    push(item) { if (q.length < 4) q.push(item); next(); },
    clear() { q.length = 0; },
  };
}

/** Reveal text character by character (live chat feel). Returns immediately under reduced motion. */
export function typeIn(el, text, cps = 90) {
  if (reduced() || text.length > 260) { el.textContent = text; return; }
  el.textContent = '';
  el.classList.add('typing');
  let i = 0;
  const start = performance.now();
  const step = (now) => {
    const n = Math.min(text.length, Math.floor(((now - start) / 1000) * cps) + 1);
    if (n !== i) { i = n; el.textContent = text.slice(0, i); }
    if (i < text.length) requestAnimationFrame(step);
    else el.classList.remove('typing');
  };
  requestAnimationFrame(step);
}
