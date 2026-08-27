import { EventEmitter } from 'node:events';
import type { ShowdownConnection, SearchState } from './connection.js';

/**
 * Watches the logged-in account's active games (pushed via |updatesearch|)
 * and joins/leaves battle rooms as they start and end. This is how we
 * "follow along" whatever battle you're currently playing without any
 * manual setup per-battle.
 */
export class RoomWatcher extends EventEmitter {
  private readonly joined = new Set<string>();

  constructor(private readonly conn: ShowdownConnection) {
    super();
    conn.on('updatesearch', (state: SearchState) => this.handleSearchState(state));
    conn.on('line', (roomid: string, line: string) => this.handleLine(roomid, line));
  }

  private handleSearchState(state: SearchState): void {
    const activeRooms = new Set(Object.keys(state.games ?? {}));

    for (const roomid of activeRooms) {
      if (!roomid.startsWith('battle-')) continue;
      if (this.joined.has(roomid)) continue;
      this.joined.add(roomid);
      this.conn.joinRoom(roomid);
      this.emit('battle-start', roomid);
    }

    for (const roomid of this.joined) {
      if (!activeRooms.has(roomid)) {
        this.joined.delete(roomid);
        this.emit('battle-end', roomid);
      }
    }
  }

  private handleLine(roomid: string, line: string): void {
    if (!roomid.startsWith('battle-')) return;
    // Belt-and-suspenders: some clients also see the terminal |win|/|tie|
    // event before the account's search state updates.
    if (line.startsWith('|win|') || line.startsWith('|tie|')) {
      this.emit('battle-ended-signal', roomid);
    }
  }
}
