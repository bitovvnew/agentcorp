// First-run onboarding: choose providers, paste keys (checked live), pick models from each provider's
// own list, build the league, save locally and start. Keys never leave this machine except to the
// provider's own API for the check.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-agentcorp': '1' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export async function mountOnboarding(root, { t, icon, langs, langName, lang, onLang, onStarted }) {
  const info = await api('/api/setup');
  const st = {
    keys: {},
    checkedKeys: {},
    models: {}, // provider -> [{id,label}]
    status: {}, // provider -> {ok, text}
    rows: (info.league?.companies ?? []).map((c) => ({ ...c })),
    scenario: info.league?.scenario ?? 'baseline',
    weeks: info.league?.weeks ?? 104,
    seed: info.league?.seed ?? Math.floor(Math.random() * 1e6),
    ollamaURL: info.ollamaURL || '',
    filter: '',
  };

  const offlineRows = () => info.personalities.map((p) => ({ brain: p.id, template: 'saas', name: '' }));

  function providerCard(p) {
    const s = st.status[p.id];
    const detected = p.id === 'ollama' ? st.models.ollama?.length : info.env[p.id] || info.saved[p.id];
    const badge = s ? (s.ok ? `<span class="pill ok">${icon('check')} ${esc(s.text)}</span>` : `<span class="pill bad">${icon('warn')} ${esc(s.text)}</span>`)
      : detected ? `<span class="pill">${icon('check')} ${esc(p.id === 'ollama' ? t('setup.ollamaFound', { n: st.models.ollama.length }) : info.env[p.id] ? t('setup.inEnv') : t('setup.saved', { key: info.saved[p.id] }))}</span>`
      : `<span class="pill dim">${esc(t('setup.notSet'))}</span>`;
    const field = p.needsKey
      ? `<input type="password" autocomplete="off" spellcheck="false" data-key="${p.id}" placeholder="${esc(p.keyHint)}" value="${esc(st.keys[p.id] || '')}" aria-label="${esc(t('setup.keyFor', { p: p.label }))}">`
      : `<input type="text" data-url="ollama" placeholder="${esc(p.keyHint)}" value="${esc(st.ollamaURL || '')}" aria-label="Ollama URL">`;
    return `<div class="prov" data-p="${p.id}">
      <div class="prov-head"><b>${esc(p.label)}</b>${badge}</div>
      <div class="prov-row">${field}<button class="btn" data-check="${p.id}">${icon('key')} ${esc(p.needsKey ? t('setup.check') : t('setup.detect'))}</button></div>
      ${p.needsKey ? `<a class="small" href="${esc(p.keyUrl)}" target="_blank" rel="noopener noreferrer">${esc(t('setup.getKey'))}</a>` : ''}
    </div>`;
  }

  function brainOptions(selected) {
    const f = st.filter.toLowerCase();
    let html = '';
    for (const p of info.providers) {
      const list = (st.models[p.id] || []).filter((m) => !f || m.id.toLowerCase().includes(f) || m.label.toLowerCase().includes(f));
      if (!list.length) continue;
      html += `<optgroup label="${esc(p.label)}">${list.slice(0, 400).map((m) => {
        const v = `${p.id}:${m.id}`;
        return `<option value="${esc(v)}"${v === selected ? ' selected' : ''}>${esc(m.label)}</option>`;
      }).join('')}</optgroup>`;
    }
    html += `<optgroup label="${esc(t('setup.offlineGroup'))}">${info.personalities.map((p) => `<option value="${p.id}"${p.id === selected ? ' selected' : ''}>${esc(t('setup.offlineLabel', { name: t(`brain.${p.id}`) }))}</option>`).join('')}</optgroup>`;
    if (selected && !html.includes(`value="${esc(selected)}"`)) html = `<option value="${esc(selected)}" selected>${esc(selected)}</option>` + html;
    return html;
  }

  function render() {
    const haveModels = Object.values(st.models).some((l) => l && l.length);
    if (!st.rows.length) st.rows = offlineRows();
    root.innerHTML = `
    <div class="setup">
      <header class="setup-head">
        <div class="kicker">${esc(t('setup.kicker'))}</div>
        <h1>${esc(t('setup.title'))}</h1>
        <p class="lede">${esc(t('setup.lede'))}</p>
        <label class="lang">${icon('globe')}<select id="ob-lang" aria-label="${esc(t('ui.language'))}">${langs.map((l) => `<option value="${l}"${l === lang ? ' selected' : ''}>${esc(langName(l))}</option>`).join('')}</select></label>
      </header>

      <section class="step"><div class="step-n">01</div><div class="step-body">
        <h2>${esc(t('setup.providers'))}</h2>
        <p class="note">${icon('shield')} ${esc(t('setup.privacy'))}</p>
        <div class="provs">${info.providers.map(providerCard).join('')}</div>
      </div></section>

      <section class="step"><div class="step-n">02</div><div class="step-body">
        <h2>${esc(t('setup.league'))}</h2>
        <div class="league-tools">
          <input type="search" id="ob-filter" placeholder="${esc(t('setup.filter'))}" value="${esc(st.filter)}">
          <button class="btn" id="ob-add">${esc(t('setup.addCompany'))}</button>
          <button class="btn ghost" id="ob-offline">${icon('cpu')} ${esc(t('setup.useOffline'))}</button>
        </div>
        <table class="rows"><thead><tr><th>#</th><th>${esc(t('setup.ceo'))}</th><th>${esc(t('setup.template'))}</th><th>${esc(t('setup.name'))}</th><th></th></tr></thead><tbody>
        ${st.rows.map((r, i) => `<tr>
          <td class="n">${String(i + 1).padStart(2, '0')}</td>
          <td><select data-row="${i}" data-f="brain">${brainOptions(r.brain)}</select></td>
          <td><select data-row="${i}" data-f="template">${info.templates.map((x) => `<option value="${esc(x.id)}"${x.id === r.template ? ' selected' : ''}>${esc(label(`tpl.${x.id}`, x.name))}</option>`).join('')}</select></td>
          <td><input data-row="${i}" data-f="name" maxlength="40" placeholder="${esc(t('setup.auto'))}" value="${esc(r.name || '')}"></td>
          <td><button class="icon-btn" data-del="${i}" aria-label="${esc(t('setup.remove'))}">${icon('close')}</button></td></tr>`).join('')}
        </tbody></table>
        ${!haveModels ? `<p class="note">${esc(t('setup.noModels'))}</p>` : ''}
        <div class="grid3">
          <label>${esc(t('setup.scenario'))}<select id="ob-scenario">${info.scenarios.map((s) => `<option value="${esc(s.id)}"${s.id === st.scenario ? ' selected' : ''}>${esc(label(`scn.${s.id}`, s.name))}</option>`).join('')}</select></label>
          <label>${esc(t('setup.weeks'))}<input id="ob-weeks" type="number" min="8" max="260" value="${st.weeks}"></label>
          <label>${esc(t('setup.seed'))}<input id="ob-seed" type="number" value="${st.seed}"></label>
        </div>
        <p class="note small">${esc(label(`scn.${st.scenario}.d`, info.scenarios.find((s) => s.id === st.scenario)?.description))}</p>
      </div></section>

      <section class="step"><div class="step-n">03</div><div class="step-body">
        <h2>${esc(t('setup.start'))}</h2>
        <p class="note">${esc(t('setup.startNote'))}</p>
        <div class="start-row"><button class="btn primary" id="ob-start">${icon('play')} ${esc(t('setup.startBtn'))}</button><span id="ob-msg" class="small" role="status"></span></div>
      </div></section>
    </div>`;
    bind();
  }

  function label(key, fallback) {
    const translated = t(key);
    return translated === key ? fallback : translated;
  }

  function collect() {
    root.querySelectorAll('[data-key]').forEach((el) => { st.keys[el.dataset.key] = el.value.trim(); });
    const u = root.querySelector('[data-url]');
    if (u) st.ollamaURL = u.value.trim();
    root.querySelectorAll('[data-row]').forEach((el) => { st.rows[+el.dataset.row][el.dataset.f] = el.value; });
    st.scenario = root.querySelector('#ob-scenario')?.value || st.scenario;
    st.weeks = Math.max(8, Math.min(260, Number(root.querySelector('#ob-weeks')?.value) || 104));
    const seed = root.querySelector('#ob-seed')?.value;
    if (seed && Number.isSafeInteger(Number(seed))) st.seed = Number(seed);
  }

  async function check(p) {
    collect();
    const key = st.keys[p];
    st.status[p] = { ok: true, text: t('setup.checking') };
    render();
    try {
      const r = await api('/api/setup/models', { provider: p, key, baseURL: p === 'ollama' ? st.ollamaURL || undefined : undefined });
      if (r.ok) {
        st.checkedKeys[p] = key;
        st.models[p] = r.models;
        st.status[p] = { ok: true, text: t('setup.valid', { n: r.models.length }) };
        if (st.rows.every((x) => info.personalities.some((q) => q.id === x.brain))) st.rows = [];
        if (!st.rows.length) {
          const pool = Object.entries(st.models).flatMap(([prov, l]) => (l || []).slice(0, 2).map((m) => `${prov}:${m.id}`));
          st.rows = pool.slice(0, 4).map((brain) => ({ brain, template: 'saas', name: '' }));
          while (st.rows.length < 2) st.rows.push({ brain: 'balanced', template: 'saas', name: '' });
        }
      } else {
        delete st.checkedKeys[p];
        st.status[p] = { ok: false, text: r.error || t('setup.invalid') };
      }
    } catch (err) {
      st.status[p] = { ok: false, text: err.message };
    }
    collect();
    render();
  }

  function bind() {
    root.querySelector('#ob-lang').addEventListener('change', (e) => { collect(); onLang(e.target.value); });
    root.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => check(b.dataset.check)));
    root.querySelectorAll('[data-key]').forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') check(el.dataset.key); }));
    root.querySelector('#ob-filter').addEventListener('change', (e) => { collect(); st.filter = e.target.value; render(); });
    root.querySelector('#ob-add').addEventListener('click', () => { collect(); if (st.rows.length < 8) st.rows.push({ brain: st.rows[st.rows.length - 1]?.brain || 'balanced', template: 'saas', name: '' }); render(); });
    root.querySelector('#ob-offline').addEventListener('click', () => { collect(); st.rows = offlineRows(); render(); });
    root.querySelector('#ob-scenario').addEventListener('change', () => { collect(); render(); });
    root.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { collect(); if (st.rows.length > 2) st.rows.splice(+b.dataset.del, 1); render(); }));
    root.querySelector('#ob-start').addEventListener('click', start);
  }

  async function start() {
    collect();
    const msg = root.querySelector('#ob-msg');
    if (st.rows.length < 1) { msg.textContent = t('setup.needOne'); return; }
    const keys = {};
    for (const [p, k] of Object.entries(st.keys)) if (k && st.checkedKeys[p] === k) keys[p] = k;
    const league = { companies: st.rows.map((r) => ({ brain: r.brain, template: r.template, ...(r.name ? { name: r.name } : {}) })), scenario: st.scenario, weeks: st.weeks, seed: st.seed, decideEvery: 4 };
    msg.textContent = t('setup.starting');
    try {
      await api('/api/setup/start', { keys, league, lang, ollamaURL: st.ollamaURL });
      onStarted();
    } catch (err) {
      msg.textContent = err.message;
    }
  }

  // Detect a local Ollama without asking.
  render();
  const initialRows = st.rows;
  const local = (async () => { try {
    const r = await api('/api/setup/models', { provider: 'ollama' });
    if (r.ok) st.models.ollama = r.models;
  } catch { /* not running */ } })();
  // Keys already in the environment or saved: list their models straight away.
  const hosted = info.providers.filter((p) => p.needsKey && (info.env[p.id] || info.saved[p.id])).map(async (p) => {
    try {
      const r = await api('/api/setup/models', { provider: p.id });
      if (r.ok) { st.models[p.id] = r.models; st.status[p.id] = { ok: true, text: t('setup.valid', { n: r.models.length }) }; }
    } catch { /* ignore */ }
  });
  void Promise.all([local, ...hosted]).then(() => {
    collect();
    if (!info.league && st.rows === initialRows && st.rows.every((r, i) => r.brain === info.personalities[i]?.id && !r.name && r.template === 'saas')) {
      const modelRows = Object.entries(st.models).flatMap(([provider, models]) =>
        models.slice(0, 2).map((m) => ({ brain: `${provider}:${m.id}`, template: 'saas', name: '' })),
      );
      if (modelRows.length) st.rows = [...modelRows, ...offlineRows()].slice(0, 4);
    }
    render();
  });
  return { rerender: (nextT, nextLang) => { t = nextT; lang = nextLang; render(); } };
}
