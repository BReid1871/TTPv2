import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { Actions } from '@pkmn/login';
import { config } from '../config.js';

export interface SearchState {
  searching: string[];
  games: Record<string, string>;
}

// Showdown enforces a per-connection flood limit and silently drops (with a
// "you've been typing too quickly" notice, not an |error|) any message sent
// faster than that. With several concurrent battles all issuing /choose,
// /timer on, and /search independently as soon as each one's analysis pass
// finishes, unpaced sends on this one shared socket collide with that limit
// -- pacing every outbound line through this interval keeps us under it.
const SEND_INTERVAL_MS = 600;

/**
 * Low-level connection to a Pokemon Showdown server: handles the websocket
 * transport, the challstr login handshake, and reconnection. Emits raw
 * protocol lines scoped by room id so higher layers can build battle state.
 */
export class ShowdownConnection extends EventEmitter {
  private ws?: WebSocket;
  private reconnectAttempt = 0;
  private closedByUser = false;
  private readonly sendQueue: string[] = [];
  private draining = false;
  loggedIn = false;

  connect(): void {
    this.closedByUser = false;
    const url = `wss://${config.server}/showdown/websocket`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on('open', () => {
      this.reconnectAttempt = 0;
      this.emit('open');
    });

    ws.on('message', (data) => {
      this.handleChunk(data.toString());
    });

    ws.on('close', () => {
      this.loggedIn = false;
      this.emit('close');
      if (!this.closedByUser) this.scheduleReconnect();
    });

    ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  close(): void {
    this.closedByUser = true;
    this.sendQueue.length = 0;
    this.ws?.close();
  }

  /** Queues a line for send, paced at SEND_INTERVAL_MS so bursts of /choose,
   * /timer on, and /search across concurrent battles never trip Showdown's
   * per-connection flood limit (see SEND_INTERVAL_MS). */
  send(line: string): void {
    this.sendQueue.push(line);
    this.drainSendQueue();
  }

  private drainSendQueue(): void {
    if (this.draining) return;
    this.draining = true;
    const step = () => {
      const line = this.sendQueue.shift();
      if (line === undefined) {
        this.draining = false;
        return;
      }
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(line);
      setTimeout(step, SEND_INTERVAL_MS).unref?.();
    };
    step();
  }

  joinRoom(roomid: string): void {
    this.send(`|/join ${roomid}`);
  }

  leaveRoom(roomid: string): void {
    this.send(`|/leave ${roomid}`);
  }

  /** Queues for a new battle in the given format (automated mode only). */
  search(format: string): void {
    this.send(`|/search ${format}`);
  }

  /** Sends a `/choose` decision for a specific battle room (automated mode only). */
  choose(roomid: string, choice: string): void {
    this.send(`${roomid}|/choose ${choice}`);
  }

  /** Turns on the battle timer for a room (automated mode only) -- without
   * this an AFK/stalling opponent can leave the battle hanging forever. */
  timerOn(roomid: string): void {
    this.send(`${roomid}|/timer on`);
  }

  private scheduleReconnect(): void {
    const delay = Math.min(30_000, 1000 * 2 ** this.reconnectAttempt);
    this.reconnectAttempt++;
    setTimeout(() => this.connect(), delay);
  }

  private handleChunk(text: string): void {
    const lines = text.split('\n');
    let roomid = 'lobby';
    if (lines[0]?.startsWith('>')) {
      roomid = lines[0].slice(1).trim() || 'lobby';
      lines.shift();
    }
    for (const line of lines) {
      this.handleGlobalLine(line);
      this.emit('line', roomid, line);
    }
  }

  private handleGlobalLine(line: string): void {
    if (line.startsWith('|challstr|')) {
      void this.login(line.slice('|challstr|'.length));
      return;
    }
    if (line.startsWith('|updatesearch|')) {
      try {
        const state = JSON.parse(line.slice('|updatesearch|'.length)) as SearchState;
        this.emit('updatesearch', state);
      } catch {
        // ignore malformed payloads
      }
      return;
    }
    if (line.startsWith('|updateuser|')) {
      const parts = line.split('|');
      const named = parts[3] === '1';
      if (named) {
        this.loggedIn = true;
        this.emit('loggedin');
      }
      return;
    }
  }

  private async login(challstr: string): Promise<void> {
    try {
      const request = Actions.login({
        username: config.username,
        password: config.password,
        challstr,
      });
      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        headers[key] = String(value);
      }
      const res = await fetch(request.url, {
        method: request.method,
        headers,
        body: request.data,
      });
      const text = await res.text();
      const command = request.onResponse(text);
      if (command) this.send(command);
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)));
    }
  }
}
