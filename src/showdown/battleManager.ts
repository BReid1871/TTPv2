import { EventEmitter } from 'node:events';
import type { ShowdownConnection } from './connection.js';
import type { RoomWatcher } from './roomWatcher.js';
import { BattleSession } from '../battle/battleSession.js';

/**
 * Owns the set of currently-tracked battle rooms, creating a BattleSession
 * for each one the RoomWatcher joins and tearing it down when the battle
 * ends. This is the top-level object the analyzer/dashboard layer watches.
 */
export class BattleManager extends EventEmitter {
  readonly sessions = new Map<string, BattleSession>();

  constructor(conn: ShowdownConnection, watcher: RoomWatcher) {
    super();

    watcher.on('battle-start', (roomid: string) => {
      if (this.sessions.has(roomid)) return;
      const session = new BattleSession(roomid);
      this.sessions.set(roomid, session);
      session.on('update', () => this.emit('battle-update', session));
      this.emit('battle-start', session);
    });

    const endSession = (roomid: string) => {
      const session = this.sessions.get(roomid);
      if (!session) return;
      this.sessions.delete(roomid);
      this.emit('battle-end', session);
      session.destroy();
    };

    watcher.on('battle-end', endSession);
    watcher.on('battle-ended-signal', (roomid: string) => {
      // Give the server a moment to send the final games update / leave the
      // room cleanly; if updatesearch doesn't confirm shortly, force it.
      setTimeout(() => {
        if (this.sessions.has(roomid)) endSession(roomid);
      }, 5000);
    });

    conn.on('line', (roomid: string, line: string) => {
      const session = this.sessions.get(roomid);
      if (session) session.addLine(line);
    });
  }
}
