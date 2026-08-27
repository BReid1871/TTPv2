import type { Pokemon as CalcPokemon, Field as CalcField } from '@smogon/calc';
import { Generations, toID } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import { computeMoveDamage } from '../calc/damage.js';
import type { CandidateScenario } from '../analysis/analyzer.js';

export type StatKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe';

// Same source as chargeMoves.ts's dataGen / battleSession.ts's `gens` --
// @smogon/calc's own move data (calcGen in calc/damage.ts) strips the
// `boosts` field along with everything else not needed for the damage
// formula itself, same caveat already documented for flags.charge.
const dataGen = new Generations(Dex).get(9);

/** A move's own self-boosts (Swords Dance -> {atk: 2}, Dragon Dance ->
 * {atk: 1, spe: 1}), straight from dex data -- undefined if this move
 * doesn't boost the user's own stats. */
export function selfBoostsFor(moveName: string): Partial<Record<StatKey, number>> | undefined {
  const boosts = dataGen.moves.get(toID(moveName))?.boosts;
  if (!boosts) return undefined;
  const entries = Object.entries(boosts).filter(([, v]) => typeof v === 'number' && v !== 0);
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries) as Partial<Record<StatKey, number>>;
}

/** Temporarily applies `delta` on top of `pokemon`'s current boosts (clamped
 * to the +/-6 stage cap) for the duration of `fn`, then restores the
 * original boosts. Deliberately mutates in place rather than using
 * @smogon/calc's Pokemon.clone() -- clone() reconstructs rawStats/stats
 * from EVs/IVs/level/nature, which would silently drop the exact
 * |request|-derived stats buildKnownPokemon manually overrides onto "your"
 * Pokemon, reintroducing the inaccuracy already found and fixed earlier
 * this session. */
export function withTemporaryBoost<T>(pokemon: CalcPokemon, delta: Partial<Record<StatKey, number>>, fn: () => T): T {
  const boosts = pokemon.boosts as any;
  const original = { ...boosts };
  for (const [stat, amount] of Object.entries(delta)) {
    boosts[stat] = Math.max(-6, Math.min(6, (boosts[stat] ?? 0) + (amount ?? 0)));
  }
  try {
    return fn();
  } finally {
    Object.assign(boosts, original);
  }
}

/** The best (highest, worst-case-aggregated) damage% any of `moveNames` can
 * do to the opponent's candidate scenarios, optionally with `boostDelta`
 * applied to the attacker first. Aggregates the same way analyzer.ts's
 * movesVsCandidateDefenders does (floor roll, worst case across candidate
 * opponent sets) so this stays consistent with the numbers already shown
 * elsewhere in the report -- this is "the guaranteed floor", not an
 * optimistic average. */
export function bestAttackDamagePercent(
  attacker: CalcPokemon,
  defenderScenarios: CandidateScenario[],
  moveNames: string[],
  field: CalcField,
  boostDelta?: Partial<Record<StatKey, number>>
): number {
  const compute = (): number => {
    let best = 0;
    for (const moveName of moveNames) {
      let min = Infinity;
      for (const scenario of defenderScenarios) {
        const result = computeMoveDamage(attacker, scenario.calcPokemon, moveName, field);
        if (!result) continue;
        min = Math.min(min, result.minPercent);
      }
      if (min !== Infinity) best = Math.max(best, min);
    }
    return best;
  };
  return boostDelta ? withTemporaryBoost(attacker, boostDelta, compute) : compute();
}
