import { EventEmitter } from 'node:events';
import { Battle } from '@pkmn/client';
import { Generations, toID } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { SideID } from '@pkmn/data';
import { Protocol } from '@pkmn/protocol';
import { LogFormatter } from '@pkmn/view';
import { config } from '../config.js';
import { DamageEvidenceTracker } from './damageEvidence.js';
import { ChargeStateTracker } from './chargeState.js';

export const gens = new Generations(Dex);

// LogFormatter.formatText's output is meant for a terminal-style text log --
// one call can bundle several sentences into a single '\n'-joined string
// (e.g. a turn header, an ability-attribution line above its effect) and
// wraps names in '**bold**' markers. Splitting into one plain sentence per
// list item (and dropping the '== Turn N ==' headers, redundant with the
// turn number already on the replay card) reads better as a discrete event
// list than as one blob of terminal text.
const TURN_HEADER = /^==.*==$/;

function splitNarrationLines(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim().replace(/\*\*/g, ''))
    .filter((line) => line.length > 0 && !TURN_HEADER.test(line));
}

/**
 * Tracks the live state of a single battle room using @pkmn/client's Battle,
 * fed by the raw protocol lines the room emits. Because the bot is logged in
 * as the same account that's playing, |request| messages (which carry full,
 * exact detail about your own team) are delivered to this connection too, so
 * "your side" is known with certainty while the opponent's side is only ever
 * as well known as what's been revealed on-screen.
 */
export class BattleSession extends EventEmitter {
  readonly battle: Battle;
  readonly roomid: string;
  readonly damageEvidence = new DamageEvidenceTracker();
  readonly chargeState = new ChargeStateTracker();
  // Pretty-prints the protocol into the same kind of play-by-play text
  // Showdown's own battle log shows ("Foo used Tackle!", "It's super
  // effective!", ...) -- used by BattleLogger to record what happened each
  // turn for the replay viewer (see index.ts's 'narration' listener).
  // `this.battle` doubles as its Tracker for full detail (species/ability/
  // item-aware text), which is why formatText must run *before* battle.add
  // below -- @pkmn/view's LogFormatter operates on the pre-update state.
  private readonly logFormatter: LogFormatter;
  mySide?: SideID;
  ended = false;

  constructor(roomid: string) {
    super();
    this.roomid = roomid;
    this.battle = new Battle(gens, toID(config.username));
    this.logFormatter = new LogFormatter(undefined, this.battle);
  }

  addLine(line: string): void {
    if (line.startsWith('|player|')) {
      const parts = line.split('|');
      const slot = parts[2] as SideID | undefined;
      const name = parts[3];
      if (slot && name && toID(name) === toID(config.username)) {
        this.mySide = slot;
        this.logFormatter.perspective = slot;
      }
    }
    if (line.startsWith('|win|') || line.startsWith('|tie|')) {
      this.ended = true;
    }

    let parsed: ReturnType<typeof Protocol.parseBattleLine>;
    try {
      parsed = Protocol.parseBattleLine(line);
    } catch (err) {
      this.emit('error', err);
      return;
    }

    // A formatting hiccup is only cosmetic (missing narration text for this
    // one line) -- isolated from the actual battle-state update below,
    // which must still succeed.
    let narration: string | undefined;
    try {
      narration = this.logFormatter.formatText(parsed.args, parsed.kwArgs) || undefined;
    } catch (err) {
      console.error(`[narration] format failed for ${this.roomid}:`, err);
    }

    try {
      this.battle.add(parsed.args, parsed.kwArgs);
    } catch (err) {
      this.emit('error', err);
      return;
    }

    this.damageEvidence.observeLine(line, this.battle, this.mySide);
    this.chargeState.observeLine(line);
    if (narration) {
      for (const text of splitNarrationLines(narration)) this.emit('narration', text);
    }
    this.emit('update', line);
  }

  get mySideObj() {
    if (!this.mySide) return undefined;
    return this.mySide === 'p1' ? this.battle.p1 : this.battle.p2;
  }

  get foeSideObj() {
    if (!this.mySide) return undefined;
    return this.mySide === 'p1' ? this.battle.p2 : this.battle.p1;
  }

  destroy(): void {
    this.battle.destroy();
    this.removeAllListeners();
  }
}
