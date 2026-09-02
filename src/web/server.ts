import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { ZipArchive } from 'archiver';
import type { AnalysisReport } from '../analysis/types.js';
import type { BattleLogger } from '../logging/battleLogger.js';
import { renderLogsPage } from './logsPage.js';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILES = new Set(['battle.log', 'reports.json', 'meta.json']);

function firstString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : Array.isArray(v) && typeof v[0] === 'string' ? v[0] : undefined;
}

function streamZip(res: Response, folder: string, filename: string): void {
  res.attachment(filename);
  const archive = new ZipArchive();
  archive.on('error', (err: Error) => res.status(500).end(String(err)));
  archive.pipe(res);
  archive.directory(folder, false);
  archive.finalize();
}

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

  constructor(private readonly logger: BattleLogger) {
    this.app.use(express.static(path.join(__dirname, 'public')));
    this.mountLogRoutes();

    this.wss.on('connection', (ws) => {
      this.send(ws, { type: 'rooms', rooms: this.rooms });
      for (const report of this.latestReports.values()) {
        this.send(ws, { type: 'report', report });
      }
    });

    if (!config.logsAccessToken) {
      console.warn('[web] LOGS_ACCESS_TOKEN not set -- /logs battle history and replays are publicly readable at this URL');
    }
  }

  /** Battle history + rewatchable replays: a listing page (/logs) plus
   * per-battle files (raw protocol log + the per-turn AnalysisReport
   * snapshots the dashboard showed live) written by BattleLogger, served
   * as JSON for /replay.html to step through. Gated by LOGS_ACCESS_TOKEN
   * if set (see requireLogAccess). */
  private mountLogRoutes(): void {
    this.app.get('/logs', this.requireLogAccess, (req, res) => {
      const summaries = this.logger.listSummaries();
      res.type('html').send(renderLogsPage(summaries, !!config.logsAccessToken, firstString(req.query.token)));
    });

    this.app.get('/logs/data', this.requireLogAccess, (req, res) => {
      res.json(this.logger.listSummaries());
    });

    this.app.get('/logs/download-all', this.requireLogAccess, (req, res) => {
      streamZip(res, this.logger.directory, 'battle-logs.zip');
    });

    this.app.get('/logs/:id/:file', this.requireLogAccess, (req, res) => {
      const id = firstString(req.params.id) ?? '';
      const file = firstString(req.params.file) ?? '';
      const folder = this.logger.folderFor(id);
      if (!folder) {
        res.status(404).send('Not found');
        return;
      }
      if (file === 'download') {
        streamZip(res, folder, `${id}.zip`);
        return;
      }
      if (!LOG_FILES.has(file)) {
        res.status(404).send('Not found');
        return;
      }
      res.sendFile(path.join(folder, file));
    });
  }

  /** No-op (calls next()) when LOGS_ACCESS_TOKEN isn't configured -- see the
   * startup warning above. Accepts the token as ?token=... or a Bearer
   * header so both browser links and scripted downloads work. */
  private requireLogAccess = (req: Request, res: Response, next: NextFunction): void => {
    const token = config.logsAccessToken;
    if (!token) {
      next();
      return;
    }
    const provided = firstString(req.query.token) ?? req.get('authorization')?.replace(/^Bearer\s+/i, '');
    if (provided === token) {
      next();
      return;
    }
    res.status(401).send('Unauthorized');
  };

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
