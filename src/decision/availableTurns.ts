/**
 * The core resource this whole decision layer is built around: how many more
 * worst-case hits a Pokemon can take before it's out of the fight. See
 * /root/.claude/plans/robust-popping-lemur.md for the design rationale --
 * this replaces a hand-weighted heuristic score (which oscillated between
 * switches and refused to sacrifice a Pokemon even when correct) with a
 * direct resource comparison, computed entirely from data the analyzer
 * already produces.
 */

/** How many more `worstCaseDamagePercent` hits `hpPercent` can absorb.
 * No plausible threat (worstCaseDamagePercent <= 0) means effectively
 * unlimited turns -- floor(x / 0) is already +Infinity in JS for x > 0, and
 * 0 HP correctly yields 0, so no special-casing is needed there. */
export function availableTurns(hpPercent: number, worstCaseDamagePercent: number): number {
  if (hpPercent <= 0) return 0;
  if (worstCaseDamagePercent <= 0) return Infinity;
  return Math.floor(hpPercent / worstCaseDamagePercent);
}

/**
 * How many more turns, from this point, it takes to finish the opponent off
 * -- the general formula unifying every action kind (see the plan): an
 * attack this turn reduces `theirHpPercent` directly by
 * `directDamageThisTurnPercent`, and every turn after this one is assumed to
 * deal `futureRatePercent` (the same move repeated, or a recomputed rate for
 * a boost/switch line -- see boostedDamage.ts).
 *
 * `directDamageThisTurnPercent` is 0 for boost/heal/utility/switch actions
 * -- none of them hit this turn -- which is exactly what makes them lose to
 * a plain attack whenever attacking alone already wins the race.
 */
export function proposedOpponentTurns(
  theirHpPercent: number,
  directDamageThisTurnPercent: number,
  futureRatePercent: number
): number {
  const remaining = theirHpPercent - directDamageThisTurnPercent;
  if (remaining <= 0) return 0;
  if (futureRatePercent <= 0) return Infinity; // no way to finish them off with this line
  return Math.ceil(remaining / futureRatePercent);
}

/** I win the race if the opponent's clock (opponentProposedAvailableTurns --
 * how many more turns until THEY'RE finished) runs out at or before mine
 * (myAvailableTurns -- how many more of their worst-case hits I can take).
 * isFaster ? tie goes to me (I land the deciding hit first) : I need to
 * strictly beat them (a tie means they get the last hit in first).
 *
 * NOTE: this was previously written the other way around
 * (myAvailableTurns <= opponentProposedAvailableTurns), which is backwards
 * -- confirmed in production it was marking a clean, faster OHKO from a
 * healthy attacker as *unfavorable* (a healthy attacker's myAvailableTurns
 * is essentially never <= an opponent already at 0 turns remaining), which
 * silently excluded it from the "favorable stay-and-act" tier every single
 * turn no matter how many times it was still the obviously correct play. */
export function isFavorable(myAvailableTurns: number, opponentProposedAvailableTurns: number, isFaster: boolean): boolean {
  return isFaster ? opponentProposedAvailableTurns <= myAvailableTurns : opponentProposedAvailableTurns < myAvailableTurns;
}
