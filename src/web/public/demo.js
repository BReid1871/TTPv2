// Renders demo-data.js through the same render* functions app.js uses for
// the live dashboard, with no websocket — a static preview of the layout.

const state = {
  reports: demoReports,
  selectedRoom: demoRooms[0].roomid,
  turnIndex: 0,
};

const statusEl = document.getElementById('conn-status');
const tabsEl = document.getElementById('room-tabs');
const turnControlEl = document.getElementById('turn-control');
const appEl = document.getElementById('app');

statusEl.textContent = 'demo data (not connected)';
statusEl.className = 'pill disconnected';

// Only room 1 has a multi-turn slice to step through (demoTurnsRoom1); other
// rooms just show their single static report.
function turnsForRoom(roomid) {
  return roomid === 'battle-gen9randombattle-1' ? demoTurnsRoom1 : null;
}

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const room of demoRooms) {
    const btn = document.createElement('button');
    btn.textContent = room.title || room.roomid;
    btn.className = room.roomid === state.selectedRoom ? 'active' : '';
    btn.onclick = () => {
      state.selectedRoom = room.roomid;
      state.turnIndex = 0;
      renderTabs();
      renderSelected();
    };
    tabsEl.appendChild(btn);
  }
}

function renderTurnControl() {
  const turns = turnsForRoom(state.selectedRoom);
  if (!turns) {
    turnControlEl.innerHTML = '';
    return;
  }
  const prevBtn = document.createElement('button');
  prevBtn.textContent = '\u25C0 Prev turn';
  prevBtn.disabled = state.turnIndex === 0;
  prevBtn.onclick = () => {
    state.turnIndex = Math.max(0, state.turnIndex - 1);
    renderTurnControl();
    renderSelected();
  };

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next turn \u25B6';
  nextBtn.disabled = state.turnIndex === turns.length - 1;
  nextBtn.onclick = () => {
    state.turnIndex = Math.min(turns.length - 1, state.turnIndex + 1);
    renderTurnControl();
    renderSelected();
  };

  const label = document.createElement('span');
  label.className = 'turn-label';
  label.textContent = `Turn ${state.turnIndex + 1} of ${turns.length}`;

  turnControlEl.innerHTML = '';
  turnControlEl.appendChild(prevBtn);
  turnControlEl.appendChild(nextBtn);
  turnControlEl.appendChild(label);
}

function renderSelected() {
  const turns = turnsForRoom(state.selectedRoom);
  const report = turns ? turns[state.turnIndex] : state.reports.get(state.selectedRoom);
  renderReport(report);
}

function hpClass(pct) {
  if (pct <= 20) return 'low';
  if (pct <= 50) return 'mid';
  return '';
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function renderMonHeader(name, hpPercent, status, sub) {
  return `
    <div class="mon-header">
      <span class="mon-name">${esc(name)}${status ? `<span class="status-chip">${esc(status)}</span>` : ''}</span>
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
      return `<tr class="${m.confirmed ? '' : 'unconfirmed'}">
        <td>${esc(m.name)}${label}</td>
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
    ${renderMonHeader(opp.species, opp.hpPercent, opp.status, `Lv.${opp.level}`)}
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
        ${renderMonHeader(matchup.yours.species, matchup.yours.hpPercent, matchup.yours.status)}
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

function renderReport(report) {
  if (report.waiting) {
    appEl.innerHTML = `<p id="empty-state">${esc(report.waitingReason || 'Waiting for battle data...')}</p>`;
    return;
  }

  let html = '';
  if (report.narrationNote) {
    html += `<div class="card"><p class="role-list" style="margin:0;">${esc(report.narrationNote)}</p></div>`;
  }
  html += `<div class="card">
    <h2 class="card-title">Turn ${report.turn} &middot; ${esc(report.format)}</h2>
    ${renderMatchup(report.active, 'Active')}
  </div>`;

  if (report.bench.length) {
    html += `<div class="card"><h2 class="card-title">Your bench vs. current opponent</h2>`;
    for (const b of report.bench) {
      html += `<details class="bench-item" open><summary><span class="mon-name">${esc(b.yours.species)}</span><span class="mon-sub">${b.yours.hpPercent}% HP &middot; ${b.speed.youAreFasterMostLikely ? 'likely faster' : 'likely slower'}</span></summary>${renderMatchup(b, 'Bench')}</details>`;
    }
    html += `</div>`;
  }

  if (report.opponentRevealedBench.length) {
    html += `<div class="card"><h2 class="card-title">Previously seen opponent Pokemon</h2>`;
    for (const o of report.opponentRevealedBench) {
      html += `<details class="bench-item" open><summary><span class="mon-name">${esc(o.species)}</span><span class="mon-sub">${o.hpPercent}% HP</span></summary><div class="matchup-grid"><div>${renderOpponentPanel(o)}</div></div></details>`;
    }
    html += `</div>`;
  }

  appEl.innerHTML = html;
}

renderTabs();
renderTurnControl();
renderSelected();
