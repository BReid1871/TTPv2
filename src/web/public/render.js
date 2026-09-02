// Shared rendering for AnalysisReport -- used by the live dashboard
// (app.js), the static layout preview (demo.js), and the saved-battle
// replay viewer (replay.js). Load this script before any of those.

function hpClass(pct) {
  if (pct <= 20) return 'low';
  if (pct <= 50) return 'mid';
  return '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Two-turn moves that hide the user (semi-invulnerable) vs. ones that just
// take 2 turns out in the open (Solar Beam, Skull Bash, ...) -- mirrors
// src/analysis/chargeMoves.ts's SEMI_INVULNERABLE set, kept small and
// hand-copied here since the client only needs the label, not the full
// per-move bypass logic that lives server-side.
const SEMI_INVULNERABLE_MOVES = new Set(['fly', 'bounce', 'dig', 'dive', 'phantom force', 'shadow force']);

function chargeChipLabel(chargingMove) {
  const hidden = SEMI_INVULNERABLE_MOVES.has(chargingMove.toLowerCase());
  return hidden ? `Semi-invulnerable (${chargingMove})` : `Charging (${chargingMove})`;
}

function renderMonHeader(name, hpPercent, status, sub, chargingMove) {
  return `
    <div class="mon-header">
      <span class="mon-name">${esc(name)}${status ? `<span class="status-chip">${esc(status)}</span>` : ''}${chargingMove ? `<span class="charge-chip">${esc(chargeChipLabel(chargingMove))}</span>` : ''}</span>
      <span class="mon-sub">${hpPercent}% HP${sub ? ` &middot; ${esc(sub)}` : ''}</span>
    </div>
    <div class="hp-bar-track"><div class="hp-bar-fill ${hpClass(hpPercent)}" style="width:${hpPercent}%"></div></div>
  `;
}

function renderTagList(dist) {
  if (dist.known) {
    return `<div class="tag-list"><span class="tag">${esc(dist.known)} <span class="pct">confirmed</span></span></div>`;
  }
  if (!dist.possible || dist.possible.length === 0) return `<div class="tag-list"><span class="tag">unknown</span></div>`;
  return `<div class="tag-list">${dist.possible
    .slice(0, 6)
    .map((o) => `<span class="tag">${esc(o.name)} <span class="pct">${Math.round(o.probability * 100)}%</span></span>`)
    .join('')}</div>`;
}

function renderMoveTable(moves, emptyLabel) {
  if (!moves || moves.length === 0) return `<p class="role-list">${emptyLabel}</p>`;
  const rows = moves
    .map((m) => {
      const pct = m.mostLikelyPercent ?? (m.minPercent + m.maxPercent) / 2;
      const barClass = pct >= 50 ? 'high' : '';
      const range = m.minPercent === m.maxPercent ? `${m.minPercent}%` : `${m.minPercent}&ndash;${m.maxPercent}%`;
      const label = m.confirmed ? '' : ` <span class="pct">(${Math.round((m.probability ?? 0) * 100)}% likely)</span>`;
      const notice = m.chargeNotice ? `<span class="charge-notice">${esc(m.chargeNotice)}</span>` : '';
      return `<tr class="${m.confirmed ? '' : 'unconfirmed'}">
        <td>${esc(m.name)}${label}${notice}</td>
        <td><span class="dmg-bar-track"><span class="dmg-bar-fill ${barClass}" style="width:${Math.min(100, pct)}%"></span></span>${range}</td>
        <td>${m.koChance ? esc(m.koChance) : ''}</td>
      </tr>`;
    })
    .join('');
  return `<table class="moves"><thead><tr><th>Move</th><th>Damage</th><th>KO chance</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderSpeed(speed) {
  const fmtFaster = (val, label) => `<span class="${val ? 'faster' : 'slower'}">${label}: ${val ? 'faster' : 'slower'}</span>`;
  return `
    <div class="section-title">Speed${speed.trickRoomActive ? ' (Trick Room active — slower moves first)' : ''}</div>
    <div class="speed-row">
      <span class="speed-val">You: ${speed.yourSpeed}</span>
      <span class="speed-val">Them: ${speed.opponentSpeedRange[0]}${speed.opponentSpeedRange[0] !== speed.opponentSpeedRange[1] ? `&ndash;${speed.opponentSpeedRange[1]}` : ''} <span class="pct">(~${speed.opponentSpeedMostLikely} most likely)</span></span>
      ${fmtFaster(speed.youAreFasterMostLikely, 'Most likely')}
      ${fmtFaster(speed.youAreFasterWorstCase, 'Worst case')}
      ${fmtFaster(speed.youAreFasterBestCase, 'Best case')}
    </div>
  `;
}

function renderOpponentPanel(opp) {
  return `
    ${renderMonHeader(opp.species, opp.hpPercent, opp.status, `Lv.${opp.level}`, opp.chargingMove)}
    ${!opp.dataFound ? '<p class="role-list">No Random Battle set data found for this species.</p>' : ''}
    <div class="section-title">Candidate roles (${opp.candidateRoles.length})</div>
    <div class="role-list">${opp.candidateRoles.map(esc).join(', ') || '&mdash;'}</div>
    <div class="section-title">Ability</div>
    ${renderTagList(opp.ability)}
    <div class="section-title">Item</div>
    ${renderTagList(opp.item)}
    <div class="section-title">Tera type</div>
    ${renderTagList(opp.teraType)}
    <div class="section-title">Revealed moves</div>
    <div class="tag-list">${opp.revealedMoves.length ? opp.revealedMoves.map((m) => `<span class="tag">${esc(m)}</span>`).join('') : '<span class="tag">none yet</span>'}</div>
    <div class="section-title">Possible remaining moves</div>
    ${renderTagList({ possible: opp.possibleRemainingMoves })}
  `;
}

function renderMatchup(matchup, title) {
  return `
    <div class="matchup-grid">
      <div>
        <div class="section-title">${esc(title)} (yours)</div>
        ${renderMonHeader(matchup.yours.species, matchup.yours.hpPercent, matchup.yours.status, undefined, matchup.yours.chargingMove)}
        <div class="section-title">Your moves vs. opponent</div>
        ${renderMoveTable(matchup.yourMovesVsOpponent, 'No damaging moves known.')}
      </div>
      <div>
        <div class="section-title">Opponent</div>
        ${renderOpponentPanel(matchup.opponent)}
        <div class="section-title">Opponent moves vs. you</div>
        ${renderMoveTable(matchup.opponentMovesVsYou, 'No damaging moves known or likely yet.')}
      </div>
    </div>
    ${renderSpeed(matchup.speed)}
  `;
}

function fmtTurns(n) {
  return n === Infinity ? '∞' : String(n);
}

// recommendedAction.action/.alternatives together always include exactly
// one 'switch' candidate per bench Pokemon (see recommendAction.ts), so the
// per-bench-mon "available turns" numbers already exist server-side --
// just look up the one matching this species rather than recomputing.
function switchEvalFor(rec, species) {
  if (!rec) return undefined;
  const label = `Switch to ${species}`;
  if (rec.action.label === label) return rec.action;
  return rec.alternatives.find((alt) => alt.kind === 'switch' && alt.label === label);
}

function renderSwitchTurns(ev) {
  if (!ev) return '';
  return ` &middot; <span class="${ev.favorable ? 'faster' : 'slower'}">switch in: mine ${fmtTurns(ev.myAvailableTurns)} turns vs. theirs ${fmtTurns(ev.opponentProposedAvailableTurns)} turns</span>`;
}

function renderRecommendedAction(rec, title) {
  if (!rec) return '';
  const a = rec.action;
  const losing = rec.verdict === 'losing';
  const alternatives = rec.alternatives
    .slice()
    .sort((x, y) => Number(y.favorable) - Number(x.favorable) || x.opponentProposedAvailableTurns - y.opponentProposedAvailableTurns)
    .map((alt) => `<li>${esc(alt.label)} <span class="pct">(${alt.kind}, ${alt.favorable ? 'favorable' : 'unfavorable'} &middot; mine ${fmtTurns(alt.myAvailableTurns)} vs. theirs ${fmtTurns(alt.opponentProposedAvailableTurns)})</span></li>`)
    .join('');
  return `
    <div class="section-title">${esc(title || 'Recommended action')}${losing ? ' <span class="status-chip">no favorable option</span>' : ''}</div>
    <div class="speed-row">
      <span class="speed-val">${esc(a.label)}</span>
      <span class="${losing ? 'slower' : 'faster'}">Mine: ${fmtTurns(a.myAvailableTurns)} turns &middot; Theirs: ${fmtTurns(a.opponentProposedAvailableTurns)} turns</span>
    </div>
    ${rec.alternatives.length ? `<details class="bench-item"><summary>Other options considered (${rec.alternatives.length})</summary><ul>${alternatives}</ul></details>` : ''}
  `;
}

// A saved battle's play-by-play for one turn -- moves used, damage, status,
// switches, faints, weather/hazard ticks -- formatted server-side via
// @pkmn/view's LogFormatter from this account's own perspective (see
// battleSession.ts). Absent/empty for the live dashboard, which has no
// equivalent buffering and isn't this feature's target -- see replay.js.
function renderEventLog(events) {
  if (!events || events.length === 0) return '';
  return `<div class="card"><h2 class="card-title">What happened</h2><ul class="event-list">${events.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
}

function renderReport(report) {
  if (report.waiting) {
    return `<p id="empty-state">${esc(report.waitingReason || 'Waiting for battle data...')}</p>`;
  }

  let html = '';
  // narrationNote is a demo-data.js-only field (see demo.html) used to
  // narrate what changed since the previous turn -- real AnalysisReports
  // never set it, so this is a no-op outside the static layout preview.
  if (report.narrationNote) {
    html += `<div class="card"><p class="role-list" style="margin:0;">${esc(report.narrationNote)}</p></div>`;
  }
  html += `<div class="card">
    <h2 class="card-title">Turn ${report.turn} &middot; ${esc(report.format)}</h2>
    ${renderRecommendedAction(report.recommendedAction)}
    ${renderMatchup(report.active, 'Active')}
  </div>`;

  if (report.bench.length) {
    html += `<div class="card"><h2 class="card-title">Your bench vs. current opponent</h2>`;
    for (const b of report.bench) {
      const switchEv = switchEvalFor(report.recommendedAction, b.yours.species);
      html += `<details class="bench-item"><summary><span class="mon-name">${esc(b.yours.species)}${b.yours.chargingMove ? `<span class="charge-chip">${esc(chargeChipLabel(b.yours.chargingMove))}</span>` : ''}</span><span class="mon-sub">${b.yours.hpPercent}% HP &middot; ${b.speed.youAreFasterMostLikely ? 'likely faster' : 'likely slower'}${renderSwitchTurns(switchEv)}</span></summary>${renderMatchup(b, 'Bench')}</details>`;
    }
    html += `</div>`;
  }

  if (report.opponentRevealedBench.length) {
    html += `<div class="card"><h2 class="card-title">Previously seen opponent Pokemon</h2>`;
    for (const o of report.opponentRevealedBench) {
      html += `<details class="bench-item"><summary><span class="mon-name">${esc(o.species)}${o.chargingMove ? `<span class="charge-chip">${esc(chargeChipLabel(o.chargingMove))}</span>` : ''}</span><span class="mon-sub">${o.hpPercent}% HP</span></summary><div class="matchup-grid"><div>${renderOpponentPanel(o)}</div></div></details>`;
    }
    html += `</div>`;
  }

  return html;
}

// Renders one src/logging/battleLogger.ts ReplayTurn -- the turn's play-by-
// play (events, via renderEventLog) followed by a saved report (the normal
// per-turn case), a forced-switch-after-faint recommendation with no full
// matchup report (recommendForcedSwitch has no report.active to attach to --
// see recommendAction.ts), or occasionally both when a faint and a fresh
// analysis pass landed on the same turn number.
function renderReplayTurn(replayTurn, appEl) {
  if (!replayTurn) {
    appEl.innerHTML = `<p id="empty-state">No advisor data for this turn.</p>`;
    return;
  }

  const eventsHtml = renderEventLog(replayTurn.events);

  if (replayTurn.report) {
    let html = eventsHtml + renderReport(replayTurn.report);
    if (replayTurn.forcedSwitch) {
      html += `<div class="card"><h2 class="card-title">Forced switch (after faint)</h2>${renderRecommendedAction(replayTurn.forcedSwitch, 'Chosen switch')}</div>`;
    }
    appEl.innerHTML = html;
    return;
  }

  if (replayTurn.forcedSwitch) {
    appEl.innerHTML = `${eventsHtml}<div class="card">
      <h2 class="card-title">Turn ${replayTurn.turn} &middot; forced switch (after faint)</h2>
      ${renderRecommendedAction(replayTurn.forcedSwitch, 'Chosen switch')}
    </div>`;
    return;
  }

  appEl.innerHTML = eventsHtml || `<p id="empty-state">No advisor data for this turn.</p>`;
}
