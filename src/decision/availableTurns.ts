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

/** isFaster ? tie goes to me : I need to strictly beat them.
 *
 * Special case at myAvailableTurns <= 0: this means their worst-case hit
 * could knock me out on its very next turn, which the plain turn-count
 * comparison doesn't actually capture -- e.g. myTurns=0 vs theirTurns=2
 * would read as "favorable" under a naive `0 <= 2`/`0 < 2` check even
 * though I'm one hit from fainting and it takes two more of my hits to
 * finish them. Zero (or negative) available turns is only genuinely
 * favorable if I'm faster AND this same action already finishes them off
 * (opponentProposedAvailableTurns <= 0) -- they never get the retaliation
 * that would otherwise kill me. */
export function isFavorable(myAvailableTurns: number, opponentProposedAvailableTurns: number, isFaster: boolean): boolean {
  if (myAvailableTurns <= 0) return isFaster && opponentProposedAvailableTurns <= 0;
  return isFaster ? myAvailableTurns <= opponentProposedAvailableTurns : myAvailableTurns < opponentProposedAvailableTurns;
}
