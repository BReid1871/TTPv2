import { config } from './config.js';
import { ShowdownConnection } from './showdown/connection.js';
import { RoomWatcher } from './showdown/roomWatcher.js';
import { BattleManager } from './showdown/battleManager.js';
import type { BattleSession } from './battle/battleSession.js';
import { RandbatsRepository } from './randbats/data.js';
import { analyzeBattle } from './analysis/analyzer.js';
import { recommendAction } from './decision/recommendAction.js';
import { DashboardServer } from './web/server.js';

const ANALYSIS_DEBOUNCE_MS = 150;

async function main() {
  const repo = new RandbatsRepository();
  await repo.start();

  const dashboard = new DashboardServer();
  dashboard.listen(config.port);

  const conn = new ShowdownConnection();
  const watcher = new RoomWatcher(conn);
  const manager = new BattleManager(conn, watcher);

  const pendingAnalysis = new Map<string, NodeJS.Timeout>();

  function scheduleAnalysis(session: BattleSession): void {
    const existing = pendingAnalysis.get(session.roomid);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      pendingAnalysis.delete(session.roomid);
      try {
        const report = analyzeBattle(session, repo);
        try {
          report.recommendedAction = recommendAction(report, session, repo);
        } catch (err) {
          console.error(`[decision] failed for ${session.roomid}:`, err);
        }
        dashboard.publishReport(report);
      } catch (err) {
        console.error(`[analysis] failed for ${session.roomid}:`, err);
      }
    }, ANALYSIS_DEBOUNCE_MS);
    timer.unref?.();
    pendingAnalysis.set(session.roomid, timer);
  }

  function updateRooms(): void {
    dashboard.setRooms([...manager.sessions.keys()].map((roomid) => ({ roomid, title: roomid })));
  }

  manager.on('battle-start', (session: BattleSession) => {
    console.log(`[battle] started: ${session.roomid}`);
    updateRooms();
    scheduleAnalysis(session);
  });

  manager.on('battle-update', (session: BattleSession) => scheduleAnalysis(session));

  manager.on('battle-end', (session: BattleSession) => {
    console.log(`[battle] ended: ${session.roomid}`);
    const timer = pendingAnalysis.get(session.roomid);
    if (timer) clearTimeout(timer);
    pendingAnalysis.delete(session.roomid);
    dashboard.removeReport(session.roomid);
    updateRooms();
  });

  conn.on('open', () => console.log('[showdown] connected'));
  conn.on('loggedin', () => console.log(`[showdown] logged in as ${config.username}`));
  conn.on('close', () => console.log('[showdown] connection closed, reconnecting...'));
  conn.on('error', (err: unknown) => console.error('[showdown] error:', err));

  conn.connect();
}

main().catch((err) => {
  console.error('Fatal error starting analyzer:', err);
  process.exit(1);
});
