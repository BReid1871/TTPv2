import type { BattleLogSummary } from '../logging/battleLogger.js';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

const RESULT_COLOR: Record<BattleLogSummary['result'], string> = {
  win: '#2e7d32',
  loss: '#c62828',
  tie: '#8a6d00',
  unknown: '#666',
};

/** Renders the /logs battle-history page: one row per saved battle, with a
 * link into the turn-by-turn replay viewer plus links to the raw files and
 * a per-battle zip download -- see src/logging/battleLogger.ts for what
 * each file contains, and src/web/public/replay.js for the replay viewer. */
export function renderLogsPage(summaries: BattleLogSummary[], tokenGated: boolean, token?: string): string {
  const qs = tokenGated && token ? `?token=${encodeURIComponent(token)}` : '';
  const replayQs = tokenGated && token ? `&token=${encodeURIComponent(token)}` : '';
  const rows = summaries
    .map((s) => {
      const opponent = s.mySide === 'p1' ? s.players.p2 : s.mySide === 'p2' ? s.players.p1 : undefined;
      return `<tr>
        <td>${escapeHtml(new Date(s.startedAt).toLocaleString())}</td>
        <td>${escapeHtml(opponent ?? '?')}</td>
        <td style="color:${RESULT_COLOR[s.result]};font-weight:600">${s.result}</td>
        <td>${escapeHtml(s.format)}</td>
        <td>${s.turns}</td>
        <td>${formatDuration(s.durationMs)}</td>
        <td class="links">
          <a href="/replay.html?id=${encodeURIComponent(s.id)}${replayQs}">watch replay</a>
          <a href="/logs/${s.id}/download${qs}">zip</a>
          <a href="/logs/${s.id}/battle.log${qs}">battle.log</a>
        </td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Battle logs</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 2rem; background: #fafafa; color: #222; }
  h1 { font-size: 1.3rem; }
  table { border-collapse: collapse; width: 100%; background: #fff; }
  th, td { text-align: left; padding: 0.5rem 0.75rem; border-bottom: 1px solid #eee; font-size: 0.9rem; }
  th { color: #666; font-weight: 600; }
  .links a { margin-right: 0.75rem; }
  .toolbar { margin: 1rem 0; }
  .empty { color: #666; padding: 1rem 0; }
</style>
</head>
<body>
  <h1>Battle logs (${summaries.length})</h1>
  <div class="toolbar"><a href="/logs/download-all${qs}">download all as .zip</a></div>
  ${summaries.length === 0
    ? '<p class="empty">No battles logged yet.</p>'
    : `<table><thead><tr><th>Started</th><th>Opponent</th><th>Result</th><th>Format</th><th>Turns</th><th>Duration</th><th>Files</th></tr></thead><tbody>${rows}</tbody></table>`}
</body>
</html>`;
}
