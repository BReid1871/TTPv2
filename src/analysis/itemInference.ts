import { toID } from '@pkmn/data';
import type { DamageEvidence } from '../battle/damageEvidence.js';
import type { SetCandidate, WeightedOption } from '../randbats/setTracker.js';
import { buildKnownPokemon, buildCandidatePokemon, buildFieldFromSnapshot, computeMoveDamage, calcGen } from '../calc/damage.js';

// DamageEvidence snapshots ability/item straight from @pkmn/client, which
// are always lowercase IDs ('lifeorb') -- but @smogon/calc's hasAbility()/
// hasItem() do exact-string matching against display names ('Life Orb'), so
// these must be converted before building a calc.Pokemon or the known side's
// own item/ability effects would silently not apply (see buildYourCalcPokemon
// in analyzer.ts, which has the same requirement).
function displayAbilityName(id: string): string {
  return calcGen.abilities.get(toID(id))?.name ?? id;
}
function displayItemName(id: string): string {
  return calcGen.items.get(toID(id))?.name ?? id;
}

/** Showdown only displays the opponent's HP to the nearest 1%, and our own
 * damage math has its own rounding, so allow a little slack before treating
 * an observation as inconsistent with a candidate. */
const DAMAGE_TOLERANCE_PERCENT = 1.5;

/**
 * A hit is only useful evidence against candidates whose ability/item could
 * plausibly have produced it -- cross-checks every accumulated observation
 * against every remaining item candidate and drops any that couldn't have
 * produced ALL of them. Falls back to the unfiltered list if evidence would
 * eliminate every candidate (should not happen, but never show zero).
 */
export function filterCandidatesByEvidence(candidates: SetCandidate[], evidence: DamageEvidence[]): SetCandidate[] {
  if (evidence.length === 0 || candidates.length === 0) return candidates;

  const survivors = candidates.filter((candidate) => evidence.every((obs) => isConsistent(candidate, obs)));
  if (survivors.length === 0) return candidates;

  const totalProbability = survivors.reduce((sum, c) => sum + c.probability, 0);
  if (totalProbability <= 0) return candidates;
  return survivors.map((c) => ({ ...c, probability: c.probability / totalProbability }));
}

function isConsistent(candidate: SetCandidate, obs: DamageEvidence): boolean {
  const known = buildKnownPokemon(obs.known.speciesForme, {
    speciesForme: obs.known.speciesForme,
    level: obs.known.level,
    ability: obs.known.ability ? displayAbilityName(obs.known.ability) : obs.known.ability,
    item: obs.known.item ? displayItemName(obs.known.item) : obs.known.item,
    status: obs.known.status,
    teraType: obs.known.teraType,
    isTerastallized: obs.known.isTerastallized,
    rawStats: obs.known.rawStats,
    boosts: obs.known.boosts,
    currentHpFraction: obs.known.currentHpFraction,
  });

  // The species being narrowed isn't carried on SetCandidate itself -- the
  // caller already filtered candidates down to one species before calling
  // filterCandidatesByEvidence, so we can reuse the species implied by the
  // evidence's opponent-side fields (there's exactly one opponent per call).
  const opponent = buildCandidatePokemon(obs.opponentSpeciesForme, {
    speciesForme: obs.opponentSpeciesForme,
    level: candidate.level,
    ability: candidate.ability,
    item: candidate.item,
    status: obs.opponentStatus,
    teraType: obs.opponentTeraType,
    isTerastallized: obs.opponentIsTerastallized,
    evs: candidate.evs,
    ivs: candidate.ivs,
    boosts: obs.opponentBoosts,
  });

  const attacker = obs.direction === 'dealt' ? opponent : known;
  const defender = obs.direction === 'dealt' ? known : opponent;
  const field = buildFieldFromSnapshot(obs.field, obs.direction === 'taken');

  const result = computeMoveDamage(attacker, defender, obs.moveId, field);
  if (!result) return true; // couldn't recompute (e.g. calc edge case) -- don't eliminate on ambiguity

  return (
    obs.damagePercent >= result.minPercent - DAMAGE_TOLERANCE_PERCENT &&
    obs.damagePercent <= result.maxPercent + DAMAGE_TOLERANCE_PERCENT
  );
}

/** Re-derive a display distribution (role / ability / item) from whatever
 * candidates survived evidence filtering, so the UI never shows a
 * probability that's inconsistent with what's actually driving the damage
 * calc. Tera type and move probabilities aren't part of SetCandidate, so
 * they're left to the existing structural (role-matching) computation. */
export function distributionFrom(candidates: SetCandidate[], pick: (c: SetCandidate) => string): WeightedOption[] {
  const dist = new Map<string, number>();
  for (const c of candidates) {
    const key = pick(c);
    dist.set(key, (dist.get(key) ?? 0) + c.probability);
  }
  return [...dist.entries()].map(([name, probability]) => ({ name, probability })).sort((a, b) => b.probability - a.probability);
}

export function roleNamesFrom(candidates: SetCandidate[]): string[] {
  return [...new Set(candidates.map((c) => c.roleName))];
}
