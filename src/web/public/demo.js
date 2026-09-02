// Renders demo-data.js through the shared render* functions in render.js
// (loaded before this script -- see demo.html), with no websocket -- a
// static preview of the layout.

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
  prevBtn.textContent = '◀ Prev turn';
  prevBtn.disabled = state.turnIndex === 0;
  prevBtn.onclick = () => {
    state.turnIndex = Math.max(0, state.turnIndex - 1);
    renderTurnControl();
    renderSelected();
  };

  const nextBtn = document.createElement('button');
  nextBtn.textContent = 'Next turn ▶';
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
  appEl.innerHTML = renderReport(report);
}

renderTabs();
renderTurnControl();
renderSelected();
