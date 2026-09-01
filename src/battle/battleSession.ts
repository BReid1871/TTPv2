import { EventEmitter } from 'node:events';
import { Battle } from '@pkmn/client';
import { Generations, toID } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { SideID } from '@pkmn/data';
import { config } from '../config.js';
import { DamageEvidenceTracker } from './damageEvidence.js';
import { ChargeStateTracker } from './chargeState.js';

export const gens = new Generations(Dex);

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
  mySide?: SideID;
  ended = false;

  constructor(roomid: string) {
    super();
    this.roomid = roomid;
    this.battle = new Battle(gens, toID(config.username));
  }

  addLine(line: string): void {
    if (line.startsWith('|player|')) {
      const parts = line.split('|');
      const slot = parts[2] as SideID | undefined;
      const name = parts[3];
      if (slot && name && toID(name) === toID(config.username)) {
        this.mySide = slot;
      }
    }
    if (line.startsWith('|win|') || line.startsWith('|tie|')) {
      this.ended = true;
    }

    try {
      this.battle.add(line);
    } catch (err) {
      this.emit('error', err);
      return;
    }

    this.damageEvidence.observeLine(line, this.battle, this.mySide);
    this.chargeState.observeLine(line);
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
