import fs from 'node:fs';
import path from 'node:path';
import { toID } from '@pkmn/data';
import type { BattleSession } from '../battle/battleSession.js';
import type { AnalysisReport } from '../analysis/types.js';
import type { RecommendedAction } from '../decision/types.js';
import { config } from '../config.js';

export interface ReplayTurn {
  turn: number;
  timestamp: number;
  /** the full report the dashboard showed live for this turn, when one
   * existed -- see index.ts's scheduleAnalysis. Absent for a turn where the
   * only thing that happened was a forced switch (see forcedSwitch below). */
  report?: AnalysisReport;
  /** set when your active fainted this turn and recommendForcedSwitch chose
   * the reply instead of the normal recommendAction pass -- analyzeBattle
   * has no report.active for that case (see recommendAction.ts), so it's
   * recorded separately rather than folded into `report`. */
  forcedSwitch?: RecommendedAction;
  /** human-readable play-by-play for this turn (moves used, damage, status,
   * switches, faints, weather/hazard ticks, ...) -- see BattleSession's
   * LogFormatter and the 'narration' listener in index.ts. Always present
   * (possibly empty) so replay.js doesn't need to special-case its absence. */
  events: string[];
}

export interface BattleLogSummary {
  id: string;
  roomid: string;
  format: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  turns: number;
  mySide?: string;
  players: { p1?: string; p2?: string };
  result: 'win' | 'loss' | 'tie' | 'unknown';
}

// `events` is assembled separately (from eventsByTurn) only once, when
// finishBattle flattens everything into the final ReplayTurn[] -- keeping it
// out of the live per-turn record avoids needing a placeholder value here
// that finishBattle would just overwrite anyway.
type LiveTurn = Omit<ReplayTurn, 'events'>;

interface LiveBattle {
  startedAt: number;
  lines: string[];
  turnsByNumber: Map<number, LiveTurn>;
  eventsByTurn: Map<number, string[]>;
}

const PLAYER_LINE = /^\|player\|(p[12])\|([^|]*)\|/;
const WIN_LINE = /^\|win\|(.+)$/;

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Buffers each live battle's raw protocol log plus a per-turn snapshot of
 * the exact AnalysisReport (recommendation + full matchup breakdown) the
 * dashboard showed at the time, then writes both to disk as a
 * self-contained folder once the battle ends -- this is what powers the
 * /replay.html rewatch view (see src/web/public/replay.js), which renders
 * saved reports through the same render* functions as the live dashboard.
 * Wired up in index.ts (normal turns, battle-start/end) and
 * automation/autoPlayer.ts (the forced-switch-after-faint case, which
 * bypasses index.ts's scheduleAnalysis entirely).
 */
export class BattleLogger {
  private readonly logDir: string;
  private readonly live = new Map<string, LiveBattle>();

  constructor(logDir: string = config.battleLogDir) {
    this.logDir = path.resolve(logDir);
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  get directory(): string {
    return this.logDir;
  }

  startBattle(roomid: string): void {
    this.live.set(roomid, { startedAt: Date.now(), lines: [], turnsByNumber: new Map(), eventsByTurn: new Map() });
  }

  recordLine(roomid: string, line: string): void {
    this.live.get(roomid)?.lines.push(line);
  }

  /** One line of human-readable play-by-play (see BattleSession's
   * LogFormatter) for the given turn -- appended, since a turn accumulates
   * several of these (each side's move, damage, status ticks, faints, ...). */
  recordNarration(roomid: string, turn: number, text: string): void {
    const live = this.live.get(roomid);
    if (!live) return;
    const arr = live.eventsByTurn.get(turn);
    if (arr) arr.push(text);
    else live.eventsByTurn.set(turn, [text]);
  }

  /** Keyed by turn: a later analysis pass on the same turn (mid-turn
   * protocol updates re-triggering scheduleAnalysis) overwrites the earlier
   * one, so the saved replay ends up with the final report actually shown
   * before you acted. */
  recordReport(roomid: string, report: AnalysisReport): void {
    const live = this.live.get(roomid);
    if (!live) return;
    const existing = live.turnsByNumber.get(report.turn);
    live.turnsByNumber.set(report.turn, { turn: report.turn, timestamp: Date.now(), forcedSwitch: existing?.forcedSwitch, report });
  }

  recordForcedSwitch(roomid: string, turn: number, action: RecommendedAction): void {
    const live = this.live.get(roomid);
    if (!live) return;
    const existing = live.turnsByNumber.get(turn);
    live.turnsByNumber.set(turn, { turn, timestamp: Date.now(), report: existing?.report, forcedSwitch: action });
  }

  /** Writes battle.log/reports.json/meta.json for `session` and clears its
   * buffers. Safe to call even if startBattle was never called for this
   * roomid (returns undefined rather than throwing). */
  async finishBattle(session: BattleSession): Promise<BattleLogSummary | undefined> {
    const live = this.live.get(session.roomid);
    if (!live) return undefined;
    this.live.delete(session.roomid);

    const players: { p1?: string; p2?: string } = {};
    let winner: string | undefined;
    let tie = false;
    for (const line of live.lines) {
      const playerMatch = line.match(PLAYER_LINE);
      if (playerMatch?.[2]) players[playerMatch[1] as 'p1' | 'p2'] = playerMatch[2];
      const winMatch = line.match(WIN_LINE);
      if (winMatch) winner = winMatch[1];
      if (line.startsWith('|tie|')) tie = true;
    }

    let result: BattleLogSummary['result'] = 'unknown';
    if (tie) result = 'tie';
    else if (winner) result = toID(winner) === toID(config.username) ? 'win' : 'loss';

    const endedAt = Date.now();
    const id = `${new Date(live.startedAt).toISOString().replace(/[:.]/g, '-')}_${sanitizeId(session.roomid)}`;
    const folder = path.join(this.logDir, id);
    fs.mkdirSync(folder, { recursive: true });

    const summary: BattleLogSummary = {
      id,
      roomid: session.roomid,
      format: session.battle.tier || '',
      startedAt: live.startedAt,
      endedAt,
      durationMs: endedAt - live.startedAt,
      turns: session.battle.turn,
      mySide: session.mySide,
      players,
      result,
    };

    // Union of both maps' keys: a turn can have narration with no logged
    // report (e.g. the fainting turn itself, when recommendForcedSwitch's
    // reply lands on the *next* turn number -- see recordForcedSwitch's
    // caller in autoPlayer.ts) or vice versa.
    const turnNumbers = new Set<number>([...live.turnsByNumber.keys(), ...live.eventsByTurn.keys()]);
    const turns: ReplayTurn[] = [...turnNumbers]
      .sort((a, b) => a - b)
      .map((turn) => {
        const existing = live.turnsByNumber.get(turn);
        return {
          turn,
          timestamp: existing?.timestamp ?? Date.now(),
          report: existing?.report,
          forcedSwitch: existing?.forcedSwitch,
          events: live.eventsByTurn.get(turn) ?? [],
        };
      });

    fs.writeFileSync(path.join(folder, 'battle.log'), live.lines.join('\n'), 'utf8');
    fs.writeFileSync(path.join(folder, 'reports.json'), JSON.stringify(turns, null, 2), 'utf8');
    fs.writeFileSync(path.join(folder, 'meta.json'), JSON.stringify(summary, null, 2), 'utf8');

    return summary;
  }

  /** Reads every saved battle's meta.json back off disk, newest first --
   * used by the /logs dashboard route. Skips any folder missing/with a
   * corrupt meta.json rather than failing the whole listing. */
  listSummaries(): BattleLogSummary[] {
    if (!fs.existsSync(this.logDir)) return [];
    const summaries: BattleLogSummary[] = [];
    for (const entry of fs.readdirSync(this.logDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        const raw = fs.readFileSync(path.join(this.logDir, entry.name, 'meta.json'), 'utf8');
        summaries.push(JSON.parse(raw));
      } catch {
        continue;
      }
    }
    return summaries.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Resolves a battle id (as returned in BattleLogSummary.id) to its
   * on-disk folder, or undefined if the id is malformed or unknown -- the
   * regex whitelist plus existence check is what makes this safe to build
   * straight from a URL param without a path-traversal risk. */
  folderFor(id: string): string | undefined {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return undefined;
    const folder = path.join(this.logDir, id);
    return fs.existsSync(folder) ? folder : undefined;
  }
}
