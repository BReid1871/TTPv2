const state = {
  rooms: [],
  reports: new Map(),
  selectedRoom: null,
};

const statusEl = document.getElementById('conn-status');
const tabsEl = document.getElementById('room-tabs');
const appEl = document.getElementById('app');

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => {
    statusEl.textContent = 'connected';
    statusEl.className = 'pill connected';
  };
  ws.onclose = () => {
    statusEl.textContent = 'disconnected — retrying...';
    statusEl.className = 'pill disconnected';
    setTimeout(connect, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.type === 'rooms') {
      state.rooms = msg.rooms;
      for (const room of msg.rooms) {
        if (!state.selectedRoom) state.selectedRoom = room.roomid;
      }
      renderTabs();
    } else if (msg.type === 'report') {
      state.reports.set(msg.report.roomid, msg.report);
      if (!state.selectedRoom) state.selectedRoom = msg.report.roomid;
      renderTabs();
      if (msg.report.roomid === state.selectedRoom) renderReport(msg.report);
    } else if (msg.type === 'remove') {
      state.reports.delete(msg.roomid);
      state.rooms = state.rooms.filter((r) => r.roomid !== msg.roomid);
      if (state.selectedRoom === msg.roomid) {
        state.selectedRoom = state.rooms[0]?.roomid ?? null;
      }
      renderTabs();
      renderSelected();
    }
  };
}

function renderTabs() {
  tabsEl.innerHTML = '';
  const known = new Map();
  for (const r of state.rooms) known.set(r.roomid, r.title || r.roomid);
  for (const roomid of state.reports.keys()) if (!known.has(roomid)) known.set(roomid, roomid);

  if (known.size <= 1) return;
  for (const [roomid, title] of known) {
    const btn = document.createElement('button');
    btn.textContent = title;
    btn.className = roomid === state.selectedRoom ? 'active' : '';
    btn.onclick = () => {
      state.selectedRoom = roomid;
      renderTabs();
      renderSelected();
    };
    tabsEl.appendChild(btn);
  }
}

function renderSelected() {
  const report = state.selectedRoom ? state.reports.get(state.selectedRoom) : undefined;
  if (report) renderReport(report);
  else appEl.innerHTML = '<p id="empty-state">Waiting for a battle... start or join a Random Battle on Pokemon Showdown and it\'ll show up here automatically.</p>';
}

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

function renderTagList(dist, knownLabel) {
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

function renderReport(report) {
  if (report.waiting) {
    appEl.innerHTML = `<p id="empty-state">${esc(report.waitingReason || 'Waiting for battle data...')}</p>`;
    return;
  }

  let html = `<div class="card">
    <h2 class="card-title">Turn ${report.turn} &middot; ${esc(report.format)}</h2>
    ${renderMatchup(report.active, 'Active')}
  </div>`;

  if (report.bench.length) {
    html += `<div class="card"><h2 class="card-title">Your bench vs. current opponent</h2>`;
    for (const b of report.bench) {
      html += `<details class="bench-item"><summary><span class="mon-name">${esc(b.yours.species)}${b.yours.chargingMove ? `<span class="charge-chip">${esc(chargeChipLabel(b.yours.chargingMove))}</span>` : ''}</span><span class="mon-sub">${b.yours.hpPercent}% HP &middot; ${b.speed.youAreFasterMostLikely ? 'likely faster' : 'likely slower'}</span></summary>${renderMatchup(b, 'Bench')}</details>`;
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

  appEl.innerHTML = html;
}

connect();
