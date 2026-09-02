// Live dashboard: connects over the /ws websocket and renders each
// incoming AnalysisReport through the shared render* functions in
// render.js (loaded before this script -- see index.html).

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
      if (msg.report.roomid === state.selectedRoom) renderReport(msg.report, appEl);
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
  if (report) renderReport(report, appEl);
  else appEl.innerHTML = '<p id="empty-state">Waiting for a battle... start or join a Random Battle on Pokemon Showdown and it\'ll show up here automatically.</p>';
}

connect();
