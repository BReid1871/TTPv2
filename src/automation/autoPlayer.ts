import { toID } from '@pkmn/data';
import type { Protocol } from '@pkmn/protocol';
import { config } from '../config.js';
import type { ShowdownConnection, SearchState } from '../showdown/connection.js';
import type { BattleManager } from '../showdown/battleManager.js';
import type { BattleSession } from '../battle/battleSession.js';
import type { RandbatsRepository } from '../randbats/data.js';
import { recommendForcedSwitch } from '../decision/recommendAction.js';
import type { AnalysisReport } from '../analysis/types.js';
import type { BattleLogger } from '../logging/battleLogger.js';

// Last-resort-only backstop (see queueNextBattle) -- normal matchmaking
// waits routinely exceed this by a lot, so it must never be short enough to
// fire during a healthy search.
const SEARCH_STALL_MS = 90_000;
// Grace period after issuing /search before trusting a |updatesearch| that
// doesn't yet list our format -- the server's own confirmation for *this*
// search can lag a beat behind an unrelated push that arrives first.
const SEARCH_CONFIRM_GRACE_MS = 3_000;

/** True for Showdown's "you've been typing too quickly" reply to a message
 * dropped by its per-connection flood limit -- sent as a |raw| line, not an
 * |error|, so it needs its own check (see handleThrottled). */
function isThrottleNotice(line: string): boolean {
  return line.startsWith('|raw|') && line.includes('message-throttle-notice');
}

/**
 * Automated-mode-only: queues for its own Random Battles and plays them
 * out, turn by turn, using the exact same RecommendedAction the dashboard
 * shows in analysis mode -- see index.ts, which only constructs this class
 * when ANALYSIS_MODE says to. Nothing here runs, and nothing here is
 * imported, on the analysis-mode path.
 */
export class AutoPlayer {
  private searching = false;
  private searchIssuedAt = 0;
  /** roomid -> rqid of the last request we already sent a /choose for, so a
   * re-run of the debounced analysis pass on the same request doesn't
   * double-act. */
  private readonly actedOn = new Map<string, number>();
  /** roomid -> the choice string last sent for that room's current rqid, so
   * a throttle notice (see handleThrottled) can resend the same choice
   * rather than needing a fresh analysis pass. */
  private readonly lastChoice = new Map<string, string>();

  constructor(
    private readonly conn: ShowdownConnection,
    private readonly manager: BattleManager,
    private readonly repo: RandbatsRepository,
    private readonly logger?: BattleLogger
  ) {
    manager.on('battle-start', (session: BattleSession) => {
      this.searching = false;
      // Without this an AFK/stalling opponent can leave the battle hanging
      // forever -- start the timer on entry so inactivity auto-forfeits.
      this.conn.timerOn(session.roomid);
      // With maxConcurrentBattles > 1, don't wait for this battle to end --
      // immediately try to fill any remaining concurrency slots too.
      this.queueNextBattle();
    });
    manager.on('battle-end', (session: BattleSession) => {
      this.actedOn.delete(session.roomid);
      this.lastChoice.delete(session.roomid);
      this.queueNextBattle();
    });
    // The server's own confirmation of our search state -- the authoritative
    // signal for whether we're actually still queued (see handleSearchUpdate).
    conn.on('updatesearch', (state: SearchState) => this.handleSearchUpdate(state));
    conn.on('line', (roomid: string, line: string) => {
      if (line.startsWith('|error|')) this.handleError(roomid, line);
      else if (isThrottleNotice(line)) this.handleThrottled(roomid);
    });
  }

  /** Call once after logging in to kick off the first search. */
  start(): void {
    this.queueNextBattle();
  }

  /** Only ever one outstanding /search at a time -- Showdown treats a second
   * /search for a format you're already searching as *cancelling* the
   * first, not queueing a second ticket, so N concurrent battles is reached
   * by re-searching immediately each time a match lands (see the
   * battle-start handler above and handleSearchUpdate below), not by
   * issuing several searches at once. */
  private queueNextBattle(): void {
    if (this.searching || this.manager.sessions.size >= config.maxConcurrentBattles) return;
    this.searching = true;
    this.searchIssuedAt = Date.now();
    this.conn.search(config.randbatsFormat);
    // Last-resort-only backstop: if the server never confirms we're
    // searching at all (a dropped |updatesearch|, a server hiccup), don't
    // sit idle forever. handleSearchUpdate (driven by the server's own
    // |updatesearch| pushes) is the primary, much faster-reacting signal --
    // this only covers that one message never arriving in the first place.
    setTimeout(() => {
      // this.searching still true this long after issuing it means this
      // particular search never resolved (no confirmation, no match) --
      // true regardless of how many *other* battles are concurrently
      // running, so unlike the size check this used to have, nothing here
      // depends on sessions.size.
      if (this.searching) {
        this.searching = false;
        this.queueNextBattle();
      }
    }, SEARCH_STALL_MS).unref?.();
  }

  /** |updatesearch| is the server's own authoritative statement of what
   * we're currently queued for -- re-sending /search on a blind timer
   * instead (the previous approach) is actively harmful, because /search
   * for a format you're already searching *cancels* that search rather
   * than confirming it, and a normal matchmaking wait routinely runs well
   * past any short timeout. Only retry once the server itself confirms
   * we've dropped out of the queue without landing a match. */
  private handleSearchUpdate(state: SearchState): void {
    if (!this.searching) return;
    if (Date.now() - this.searchIssuedAt < SEARCH_CONFIRM_GRACE_MS) return;
    const stillSearching = (state.searching ?? []).includes(config.randbatsFormat);
    if (stillSearching) return;
    // No longer searching for this format -- either a match landed (the
    // battle-start handler already cleared `searching` and re-queued, so
    // the early return above already caught that case) or the search
    // genuinely dropped. Either way, sessions.size is irrelevant here with
    // maxConcurrentBattles > 1 -- other unrelated battles can legitimately
    // be in progress while *this* search dropped.
    this.searching = false;
    this.queueNextBattle();
  }

  /** A /choose the server rejected (e.g. we recommended a switch while
   * trapped) -- fall back to Showdown's own "default" choice so the match
   * never stalls, and allow the next analysis pass to act again. */
  private handleError(roomid: string, line: string): void {
    if (!this.manager.sessions.has(roomid)) return;
    console.warn(`[auto] choice rejected in ${roomid}, using default: ${line}`);
    this.actedOn.delete(roomid);
    this.lastChoice.set(roomid, 'default');
    this.conn.choose(roomid, 'default');
  }

  /** Showdown's per-connection flood limit silently drops an over-the-limit
   * message and replies with this notice instead of an |error| -- so a
   * throttled /choose previously went undetected: actedOn was already set,
   * nothing else was going to re-trigger analysis for this room, and the
   * battle just timed out. Resend the same choice we already decided on. */
  private handleThrottled(roomid: string): void {
    if (!this.manager.sessions.has(roomid)) return;
    const choice = this.lastChoice.get(roomid);
    if (!choice) return;
    console.warn(`[auto] choice possibly throttled in ${roomid}, resending: ${choice}`);
    this.conn.choose(roomid, choice);
  }

  /** Called after each debounced analysis pass (see index.ts) with the
   * report + recommendation already computed for this update. */
  act(session: BattleSession, report: AnalysisReport): void {
    if (session.ended) return;
    const request = session.battle.request;
    if (!request || request.requestType === 'wait') return;
    if (this.actedOn.get(session.roomid) === request.rqid) return;

    const choice = this.resolveChoice(session, request, report);
    if (!choice) return;
    this.actedOn.set(session.roomid, request.rqid);
    this.lastChoice.set(session.roomid, choice);
    this.conn.choose(session.roomid, choice);
  }

  private resolveChoice(session: BattleSession, request: Protocol.Request, report: AnalysisReport): string | undefined {
    if (request.requestType === 'team') {
      // Random Battle team order has no real strategic weight (the whole
      // team gets seen either way) -- keep it simple and lead with slot 1.
      return `team ${request.side.pokemon.map((_, i) => i + 1).join('')}`;
    }

    if (request.requestType === 'switch') {
      const forced = recommendForcedSwitch(session, this.repo);
      if (forced) this.logger?.recordForcedSwitch(session.roomid, session.battle.turn, forced);
      return this.switchChoiceFor(request.side.pokemon, forced?.action.label) ?? this.firstLegalSwitch(request.side.pokemon);
    }

    if (request.requestType === 'move') {
      const active = request.active[0];
      if (!active) return undefined;
      // A pending Recharge (post-Hyper Beam etc.) leaves exactly one legal
      // choice and isn't something recommendAction models -- just take it.
      if (active.moves.length === 1 && active.moves[0].id === 'recharge') return 'move 1';

      const action = report.recommendedAction?.action;
      if (action?.kind === 'switch') {
        const choice = this.switchChoiceFor(request.side.pokemon, action.label);
        if (choice) return choice;
      } else if (action?.kind === 'tera') {
        // label is a display string ("Terastallize (Type) + MoveName") for
        // this kind, not a plain move name -- teraMoveName carries the
        // actual move to send. Only append the flag if Tera is still legal
        // by the time we act (a prior request could've already used it).
        const choice = action.teraMoveName && this.moveChoiceFor(active, action.teraMoveName);
        if (choice) return active.canTerastallize ? `${choice} terastallize` : choice;
      } else if (action) {
        const choice = this.moveChoiceFor(active, action.label);
        if (choice) return choice;
      }
      // Recommendation missing, or stale by the time we act (a Disable/
      // Encore/Choice lock landed in the last 150ms) -- fall back to the
      // best still-legal damaging move, then any legal move.
      return this.fallbackMoveChoice(active, report);
    }

    return undefined;
  }

  private moveChoiceFor(active: Protocol.Request.ActivePokemon, moveLabel: string): string | undefined {
    const idx = active.moves.findIndex((m) => !('disabled' in m && m.disabled) && toID(m.name) === toID(moveLabel));
    return idx >= 0 ? `move ${idx + 1}` : undefined;
  }

  private fallbackMoveChoice(active: Protocol.Request.ActivePokemon, report: AnalysisReport): string {
    const ranked = (report.active?.yourMovesVsOpponent ?? [])
      .filter((m) => m.confirmed)
      .slice()
      .sort((a, b) => b.minPercent - a.minPercent);
    for (const move of ranked) {
      const choice = this.moveChoiceFor(active, move.name);
      if (choice) return choice;
    }
    const idx = active.moves.findIndex((m) => !('disabled' in m && m.disabled));
    return idx >= 0 ? `move ${idx + 1}` : 'move 1';
  }

  private switchChoiceFor(pokemon: Protocol.Request.Pokemon[], label: string | undefined): string | undefined {
    if (!label) return undefined;
    const species = label.replace(/^Switch to /, '');
    const idx = pokemon.findIndex((p) => !p.active && !p.fainted && p.hp > 0 && p.speciesForme === species);
    return idx >= 0 ? `switch ${idx + 1}` : undefined;
  }

  private firstLegalSwitch(pokemon: Protocol.Request.Pokemon[]): string | undefined {
    const idx = pokemon.findIndex((p) => !p.active && !p.fainted && p.hp > 0);
    return idx >= 0 ? `switch ${idx + 1}` : undefined;
  }
}
