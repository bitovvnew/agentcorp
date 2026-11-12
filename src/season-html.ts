// Standalone HTML standings page for a season (shareable, no server).
import { fmtTokens } from './economy.js';
import type { SeasonResult } from './season.js';

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

export function seasonHtml(r: SeasonResult): string {
  const max = Math.max(1, ...r.standings.map((s) => s.points));
  const rows = r.standings.map((s, i) => `
    <tr><td class="pos">${String(i + 1).padStart(2, '0')}</td><td><b>${esc(s.brainLabel)}</b><div class="spec">${esc(s.brainSpec)}</div></td>
    <td class="bar"><span style="width:${Math.max(2, (Math.max(0, s.points) / max) * 100)}%"></span></td>
    <td class="n big">${s.points}</td><td class="n">${s.wins}</td><td class="n">${s.podiums}</td><td class="n">${s.unicorns}</td><td class="n">${s.deaths}</td><td class="n">${fmtTokens(s.avgValuation)}</td></tr>`).join('');
  const races = r.races.map((race) => `<li><span class="k">${esc(race.scenario)} · seed ${race.seed}</span> ${race.table.map((t) => `${esc(t.brainLabel)} <i>${t.status === 'bankrupt' ? '✕' : fmtTokens(t.valuation)}</i>`).join(' · ')}</li>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>AgentCorp season standings</title>
<style>
:root{color-scheme:dark;--ink:#0d0d0c;--paper:#ede9df;--mute:#8b877c;--rule:#2b2a26;--signal:#ff5b1f}
body{margin:0;background:var(--ink);color:var(--paper);font:15px/1.5 ui-sans-serif,system-ui,"Segoe UI",sans-serif}
main{max-width:980px;margin:0 auto;padding:48px 20px}
h1{font:600 clamp(36px,6vw,64px)/1 "Iowan Old Style","Charter","Georgia",serif;letter-spacing:-.02em;margin:0 0 6px}
.kick{font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--signal)}
.sub{color:var(--mute);margin-bottom:32px}
table{width:100%;border-collapse:collapse;border-top:2px solid var(--paper)}
th{font:500 11px ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.1em;color:var(--mute);text-align:left;padding:10px 8px;border-bottom:1px solid var(--rule)}
td{padding:12px 8px;border-bottom:1px solid var(--rule);vertical-align:middle}
.n{text-align:right;font-family:ui-monospace,Menlo,Consolas,monospace;font-variant-numeric:tabular-nums}
.big{font-size:20px;font-weight:700}.pos{font:700 20px ui-monospace,Menlo,monospace;color:var(--mute);width:40px}
tr:first-child .pos{color:var(--signal)}
.spec{font:12px ui-monospace,Menlo,monospace;color:var(--mute)}
.bar{width:28%}.bar span{display:block;height:6px;background:var(--paper)}tr:first-child .bar span{background:var(--signal)}
ol{list-style:none;padding:0;margin:32px 0 0;font-size:13px;color:var(--mute)}li{padding:6px 0;border-bottom:1px solid var(--rule)}
.k{color:var(--paper);font-family:ui-monospace,Menlo,monospace;margin-right:8px}i{font-style:normal;color:var(--paper)}
@media(max-width:640px){.bar{display:none}}
</style></head><body><main>
<div class="kick">AgentCorp · season standings</div>
<h1>${esc(r.standings[0]?.brainLabel ?? '')} takes the season</h1>
<div class="sub">${r.races.length} races · ${r.weeks} weeks each · 25-18-15-12-10 points, +5 for a unicorn, −3 for a shutdown</div>
<table><thead><tr><th></th><th>CEO</th><th></th><th class="n">Pts</th><th class="n">Wins</th><th class="n">Podiums</th><th class="n">Unicorns</th><th class="n">Dead</th><th class="n">Avg val.</th></tr></thead><tbody>${rows}</tbody></table>
<ol>${races}</ol>
</main></body></html>`;
}
