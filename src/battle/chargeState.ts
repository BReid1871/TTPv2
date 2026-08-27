/**
 * Tracks which Pokemon (by protocol ident) are mid-charge on a two-turn move
 * (Fly, Dig, Dive, Bounce, Phantom Force, Shadow Force, ...) and therefore
 * semi-invulnerable until their charge resolves next turn.
 *
 * @pkmn/client doesn't track this itself -- it has no handler at all for the
 * |-prepare| line Showdown sends when a charge begins -- so this is watched
 * directly off the raw protocol stream, the same pattern as
 * DamageEvidenceTracker. A charging Pokemon's state clears on its next
 * |move| line (the release turn, i.e. the charge is over), or if it
 * switches out or faints mid-charge.
 */
export class ChargeStateTracker {
  private readonly chargingMoveId = new Map<string, string>();

  observeLine(line: string): void {
    if (!line.startsWith('|')) return;
    const parts = line.slice(1).split('|');
    const type = parts[0];
    switch (type) {
      case '-prepare': {
        const ident = parts[1];
        const moveName = parts[2];
        if (ident && moveName) this.chargingMoveId.set(ident, moveName);
        return;
      }
      case 'move':
      case 'switch':
      case 'drag':
      case 'faint': {
        const ident = parts[1];
        if (ident) this.chargingMoveId.delete(ident);
        return;
      }
      default:
        return;
    }
  }

  /** The move name (as sent by the server, e.g. 'Fly') this Pokemon is
   * currently charging and semi-invulnerable for, if any. */
  chargingMove(ident: string): string | undefined {
    return this.chargingMoveId.get(ident);
  }
}
