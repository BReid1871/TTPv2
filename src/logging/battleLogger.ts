import fs from 'node:fs';
import path from 'node:path';
import { toID } from '@pkmn/data';
import type { BattleSession } from '../battle/battleSession.js';
import type { RecommendedAction } from '../decision/types.js';
import { config } from '../config.js';

export interface DecisionLogEntry {
  turn: number;
  timestamp: number;
  /** 'turn' = a normal move/switch decision via recommendAction; 'forced-switch'
   * = your active just fainted, decided via recommendForcedSwitch instead
   * (analyzeBattle has no report.active for that case -- see recommendAction.ts). */
  kind: 'turn' | 'forced-switch';
  yourActive?: { species: string; hpPercent: number; status?: string };
  opponentActive?: { species: string; hpPercent: number; status?: string; candidateRoles: string[] };
  verdict: RecommendedAction['verdict'];
  chosen: RecommendedAction['action'];
  alternatives: RecommendedAction['action'][];
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

interface LiveBattle {
  startedAt: number;
  lines: string[];
  decisionsByTurn: Map<number, DecisionLogEntry>;
}

const PLAYER_LINE = /^\|player\|(p[12])\|([^|]*)\|/;
const WIN_LINE = /^\|win\|(.+)$/;

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Buffers each live battle's raw protocol log plus a per-turn snapshot of
 * what the decision engine chose and every alternative it weighed, then
 * writes both to disk as a self-contained folder once the battle ends.
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
    this.live.set(roomid, { startedAt: Date.now(), lines: [], decisionsByTurn: new Map() });
  }

  recordLine(roomid: string, line: string): void {
    this.live.get(roomid)?.lines.push(line);
  }

  recordDecision(roomid: string, entry: DecisionLogEntry): void {
    // Keyed by turn: later analysis passes on the same turn (mid-turn
    // protocol updates re-triggering scheduleAnalysis) overwrite earlier
    // ones, so the file ends up with the final decision actually acted on.
    this.live.get(roomid)?.decisionsByTurn.set(entry.turn, entry);
  }

  /** Writes battle.log/recommendations.json/meta.json for `session` and
   * clears its buffers. Safe to call even if startBattle was never called
   * for this roomid (returns undefined rather than throwing). */
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

    const decisions = [...live.decisionsByTurn.values()].sort((a, b) => a.turn - b.turn);

    fs.writeFileSync(path.join(folder, 'battle.log'), live.lines.join('\n'), 'utf8');
    fs.writeFileSync(path.join(folder, 'recommendations.json'), JSON.stringify(decisions, null, 2), 'utf8');
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
