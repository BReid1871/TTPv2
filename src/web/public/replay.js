// Rewatches a saved battle: steps through the per-turn AnalysisReport
// snapshots BattleLogger wrote to reports.json, one turn at a time, through
// the same render* functions the live dashboard uses (render.js, loaded
// before this script). Supports stepping one turn at a time, autoplay with
// pause, and jumping straight to a turn via the slider.

const PLAY_INTERVAL_MS = 2500;

const params = new URLSearchParams(location.search);
const battleId = params.get('id');
const token = params.get('token');

const metaEl = document.getElementById('replay-meta');
const turnControlEl = document.getElementById('turn-control');
const appEl = document.getElementById('app');

const state = {
  turns: [],
  index: 0,
  playing: false,
  timer: null,
};

function withToken(url) {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}

async function fetchJson(url) {
  const res = await fetch(withToken(url));
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

const RESULT_LABEL = { win: 'Win', loss: 'Loss', tie: 'Tie', unknown: 'Unknown result' };

function renderMeta(meta) {
  const opponent = meta.mySide === 'p1' ? meta.players.p2 : meta.mySide === 'p2' ? meta.players.p1 : undefined;
  metaEl.innerHTML = `
    <div class="card" style="margin:12px 20px;max-width:1200px;">
      <div class="speed-row">
        <span class="speed-val">vs. ${esc(opponent ?? '?')}</span>
        <span class="${meta.result === 'win' ? 'faster' : meta.result === 'loss' ? 'slower' : ''}">${esc(RESULT_LABEL[meta.result] ?? meta.result)}</span>
        <span class="mon-sub">${esc(meta.format)}</span>
        <span class="mon-sub">${new Date(meta.startedAt).toLocaleString()}</span>
      </div>
    </div>
  `;
}

function stopPlaying() {
  state.playing = false;
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

function goTo(index) {
  state.index = Math.max(0, Math.min(state.turns.length - 1, index));
  renderTurnControl();
  renderCurrentTurn();
}

function step(delta) {
  stopPlaying();
  renderTurnControl();
  goTo(state.index + delta);
}

function togglePlay() {
  if (state.playing) {
    stopPlaying();
    renderTurnControl();
    return;
  }
  if (state.index >= state.turns.length - 1) state.index = 0;
  state.playing = true;
  state.timer = setInterval(() => {
    if (state.index >= state.turns.length - 1) {
      stopPlaying();
      renderTurnControl();
      return;
    }
    goTo(state.index + 1);
  }, PLAY_INTERVAL_MS);
  renderTurnControl();
  renderCurrentTurn();
}

function renderTurnControl() {
  const turns = state.turns;
  turnControlEl.innerHTML = '';
  if (turns.length === 0) return;

  const prevBtn = document.createElement('button');
  prevBtn.textContent = '◀ Prev turn';
  prevBtn.disabled = state.index === 0;
  prevBtn.onclick = () => step(-1);

  const playBtn = document.createElement('button');
  playBtn.textContent = state.playing ? '⏸ Pause' : '▶ Play';
  playBtn.onclick = togglePlay;

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next turn ▶';
  nextBtn.disabled = state.index === turns.length - 1;
  nextBtn.onclick = () => step(1);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(turns.length - 1);
  slider.value = String(state.index);
  slider.style.flex = '1';
  slider.oninput = () => {
    stopPlaying();
    renderTurnControl();
    goTo(Number(slider.value));
  };

  const label = document.createElement('span');
  label.className = 'turn-label';
  label.textContent = `Turn ${turns[state.index].turn} (${state.index + 1} of ${turns.length})`;

  turnControlEl.appendChild(prevBtn);
  turnControlEl.appendChild(playBtn);
  turnControlEl.appendChild(nextBtn);
  turnControlEl.appendChild(slider);
  turnControlEl.appendChild(label);
}

function renderCurrentTurn() {
  renderReplayTurn(state.turns[state.index], appEl);
}

document.addEventListener('keydown', (e) => {
  if (state.turns.length === 0) return;
  if (e.key === 'ArrowLeft') step(-1);
  else if (e.key === 'ArrowRight') step(1);
  else if (e.key === ' ') {
    e.preventDefault();
    togglePlay();
  }
});

async function main() {
  if (!battleId) {
    appEl.innerHTML = '<p id="empty-state">No battle id given -- open this page from the <a href="/logs">battle history</a> list.</p>';
    return;
  }
  try {
    const [meta, turns] = await Promise.all([
      fetchJson(`/logs/${encodeURIComponent(battleId)}/meta.json`),
      fetchJson(`/logs/${encodeURIComponent(battleId)}/reports.json`),
    ]);
    renderMeta(meta);
    state.turns = turns;
    if (turns.length === 0) {
      appEl.innerHTML = '<p id="empty-state">No advisor data was recorded for this battle.</p>';
      return;
    }
    renderTurnControl();
    renderCurrentTurn();
  } catch (err) {
    appEl.innerHTML = `<p id="empty-state">Failed to load replay: ${esc(String(err))}</p>`;
  }
}

main();
