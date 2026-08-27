import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import type { AnalysisReport } from '../analysis/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface RoomSummary {
  roomid: string;
  title?: string;
}

/**
 * Minimal live dashboard: serves the static UI and pushes AnalysisReport
 * updates to every connected browser over a websocket as they happen.
 */
export class DashboardServer {
  private readonly app = express();
  private readonly httpServer = createServer(this.app);
  private readonly wss = new WebSocketServer({ server: this.httpServer, path: '/ws' });
  private readonly latestReports = new Map<string, AnalysisReport>();
  private rooms: RoomSummary[] = [];

  constructor() {
    this.app.use(express.static(path.join(__dirname, 'public')));

    this.wss.on('connection', (ws) => {
      this.send(ws, { type: 'rooms', rooms: this.rooms });
      for (const report of this.latestReports.values()) {
        this.send(ws, { type: 'report', report });
      }
    });
  }

  listen(port: number): void {
    this.httpServer.listen(port, () => {
      console.log(`[web] dashboard listening on port ${port}`);
    });
  }

  setRooms(rooms: RoomSummary[]): void {
    this.rooms = rooms;
    this.broadcast({ type: 'rooms', rooms });
  }

  publishReport(report: AnalysisReport): void {
    this.latestReports.set(report.roomid, report);
    this.broadcast({ type: 'report', report });
  }

  removeReport(roomid: string): void {
    this.latestReports.delete(roomid);
    this.broadcast({ type: 'remove', roomid });
  }

  private send(ws: WebSocket, message: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }

  private broadcast(message: unknown): void {
    const data = JSON.stringify(message);
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  }
}
