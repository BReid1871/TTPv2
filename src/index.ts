import { config } from './config.js';
import { ShowdownConnection } from './showdown/connection.js';
import { RoomWatcher } from './showdown/roomWatcher.js';
import { BattleManager } from './showdown/battleManager.js';
import type { BattleSession } from './battle/battleSession.js';
import { RandbatsRepository } from './randbats/data.js';
import { analyzeBattle } from './analysis/analyzer.js';
import { recommendAction } from './decision/recommendAction.js';
import { DashboardServer } from './web/server.js';
import { AutoPlayer } from './automation/autoPlayer.js';
import { BattleLogger } from './logging/battleLogger.js';

const ANALYSIS_DEBOUNCE_MS = 150;

async function main() {
  const repo = new RandbatsRepository();
  await repo.start();

  const logger = new BattleLogger();

  const dashboard = new DashboardServer(logger);
  dashboard.listen(config.port);

  const conn = new ShowdownConnection();
  const watcher = new RoomWatcher(conn);
  const manager = new BattleManager(conn, watcher);
  // analysis (default/legacy): watch-only, never sends battle commands.
  // automated: queues for and plays its own matches, one after another.
  // auto-accept: never searches -- accepts any incoming challenge instead.
  // automated/auto-accept both play using the same recommendations below.
  const autoPlayer = config.mode === 'analysis' ? undefined : new AutoPlayer(conn, manager, repo, config.mode, logger);
  const MODE_LABEL = {
    analysis: 'analysis (watch-only)',
    automated: 'automated (plays its own matches)',
    'auto-accept': 'auto-accept (accepts incoming challenges, never searches)',
  } as const;
  console.log(`[mode] ${MODE_LABEL[config.mode]}`);

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
        try {
          if (report.active && report.recommendedAction) logger.recordReport(session.roomid, report);
        } catch (err) {
          console.error(`[log] report recording failed for ${session.roomid}:`, err);
        }
        try {
          autoPlayer?.act(session, report);
        } catch (err) {
          console.error(`[auto] failed for ${session.roomid}:`, err);
        }
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
    logger.startBattle(session.roomid);
    session.on('update', (line: string) => logger.recordLine(session.roomid, line));
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
    logger
      .finishBattle(session)
      .then((summary) => summary && console.log(`[log] saved ${summary.id} (${summary.result})`))
      .catch((err) => console.error(`[log] failed to save battle ${session.roomid}:`, err));
  });

  conn.on('open', () => console.log('[showdown] connected'));
  conn.on('loggedin', () => {
    console.log(`[showdown] logged in as ${config.username}`);
    autoPlayer?.start();
  });
  conn.on('close', () => console.log('[showdown] connection closed, reconnecting...'));
  conn.on('error', (err: unknown) => console.error('[showdown] error:', err));

  conn.connect();
}

main().catch((err) => {
  console.error('Fatal error starting analyzer:', err);
  process.exit(1);
});
