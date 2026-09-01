import { toID } from '@pkmn/data';

/**
 * Tracks, per protocol ident, the distinct moves a Pokemon has actually
 * chosen since it last switched in. Choice Band/Specs/Scarf lock the holder
 * into its first move until it switches out again, so seeing two distinct
 * real move choices from the same send-out is a hard, deterministic proof
 * it isn't holding one -- unlike the damage-magnitude evidence in
 * damageEvidence.ts, there's no tolerance here: it either did or didn't
 * happen.
 *
 * Struggle (0 PP left on every move) and a move called by another move
 * (Metronome, Sleep Talk, Assist, ...) both carry no information about free
 * choice -- Struggle can happen while still locked, and a called move
 * doesn't touch the Choice lock at all -- so neither is counted.
 */
export class ChoiceLockTracker {
  private readonly movesSinceSwitchIn = new Map<string, Set<string>>();

  observeLine(line: string): void {
    if (!line.startsWith('|')) return;
    const parts = line.slice(1).split('|');
    const type = parts[0];
    switch (type) {
      case 'switch':
      case 'drag': {
        const ident = parts[1];
        if (ident) this.movesSinceSwitchIn.set(ident, new Set());
        return;
      }
      case 'move': {
        const ident = parts[1];
        const moveName = parts[2];
        if (!ident || !moveName) return;
        const moveId = toID(moveName);
        if (moveId === 'struggle') return;
        if (parts.some((p) => p.startsWith('[from]'))) return; // called by another move, not a free choice
        const moves = this.movesSinceSwitchIn.get(ident) ?? new Set<string>();
        moves.add(moveId);
        this.movesSinceSwitchIn.set(ident, moves);
        return;
      }
      default:
        return;
    }
  }

  /** True once this Pokemon has freely chosen 2+ distinct moves since it
   * last switched in -- a hard rule-out for Choice Band/Specs/Scarf. */
  ruledOutChoiceItem(ident: string): boolean {
    return (this.movesSinceSwitchIn.get(ident)?.size ?? 0) >= 2;
  }
}
