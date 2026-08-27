import { toID } from '@pkmn/data';
import type { RandbatsRepository, RandbatsRole } from './data.js';

export interface WeightedOption {
  name: string;
  probability: number;
}

export type StatsTable = { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };

export const DEFAULT_EVS: StatsTable = { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 };
export const DEFAULT_IVS: StatsTable = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 };

export interface NarrowedSet {
  speciesLookupKey: string;
  found: boolean;
  level: number;
  candidateRoleNames: string[];
  ability: { known?: string; possible: WeightedOption[] };
  item: { known?: string; possible: WeightedOption[] };
  teraType: { known?: string; possible: WeightedOption[] };
  revealedMoves: string[];
  possibleRemainingMoves: WeightedOption[];
}

/** A single concrete guess at "the whole set", used to drive damage calc scenarios. */
export interface SetCandidate {
  roleName: string;
  probability: number;
  ability: string;
  item: string;
  evs: StatsTable;
  ivs: StatsTable;
  level: number;
}

export interface PokemonRevealState {
  speciesForme: string;
  baseSpeciesName: string;
  level: number;
  /** '' means not yet revealed */
  ability: string;
  /** '' means not currently held (never revealed, or consumed/knocked off) */
  item: string;
  /** last known item even if since consumed/knocked off, for identity purposes */
  lastItem: string;
  moveIds: string[];
  /** set only once the Pokemon has actually Terastallized this battle */
  teraType?: string;
}

function hasId(list: string[], id: string): boolean {
  const wantId = toID(id);
  return list.some((entry) => toID(entry) === wantId);
}

function accumulate(dist: Map<string, number>, options: string[], totalWeight: number): void {
  if (options.length === 0) return;
  const each = totalWeight / options.length;
  for (const opt of options) {
    dist.set(opt, (dist.get(opt) ?? 0) + each);
  }
}

function toSorted(dist: Map<string, number>): WeightedOption[] {
  return [...dist.entries()]
    .map(([name, probability]) => ({ name, probability }))
    .sort((a, b) => b.probability - a.probability);
}

function roleMatches(
  role: RandbatsRole,
  info: { knownAbility?: string; knownItem?: string; knownTera?: string; revealedMoves: string[] }
): boolean {
  if (info.knownAbility && !hasId(role.abilities, info.knownAbility)) return false;
  if (info.knownItem && !hasId(role.items, info.knownItem)) return false;
  if (info.knownTera && !hasId(role.teraTypes, info.knownTera)) return false;
  for (const moveId of info.revealedMoves) {
    if (!hasId(role.moves, moveId)) return false;
  }
  return true;
}

/**
 * Narrows the set of plausible Random Battle "roles" (Smogon's term for the
 * pre-built archetypes a species can roll) down to the ones still consistent
 * with everything we've seen this Pokemon do, and produces a probability
 * distribution over the remaining unknowns.
 */
export function narrowSet(pokemon: PokemonRevealState, repo: RandbatsRepository): NarrowedSet {
  const speciesEntry = repo.lookup(pokemon.speciesForme) ?? repo.lookup(pokemon.baseSpeciesName);
  const revealedMoves = pokemon.moveIds.filter(Boolean);
  const knownAbility = pokemon.ability || undefined;
  // Prefer the currently-held item; fall back to the last known item (e.g.
  // knocked off / consumed berry) so we don't lose identity information.
  const knownItem = pokemon.item || pokemon.lastItem || undefined;
  const knownTera = pokemon.teraType;

  if (!speciesEntry) {
    return {
      speciesLookupKey: pokemon.speciesForme,
      found: false,
      level: pokemon.level,
      candidateRoleNames: [],
      ability: { known: knownAbility, possible: knownAbility ? [{ name: knownAbility, probability: 1 }] : [] },
      item: { known: knownItem, possible: knownItem ? [{ name: knownItem, probability: 1 }] : [] },
      teraType: { known: knownTera, possible: knownTera ? [{ name: knownTera, probability: 1 }] : [] },
      revealedMoves,
      possibleRemainingMoves: [],
    };
  }

  let roleEntries = Object.entries(speciesEntry.roles).filter(([, role]) =>
    roleMatches(role, { knownAbility, knownItem, knownTera, revealedMoves })
  );
  const inconsistent = roleEntries.length === 0;
  if (inconsistent) {
    // Nothing matches (stale data, an ID-normalization mismatch, or a
    // genuinely off-pool set) -- fall back to every role rather than
    // reporting zero candidates.
    roleEntries = Object.entries(speciesEntry.roles);
  }

  const roleWeight = 1 / roleEntries.length;
  const abilityDist = new Map<string, number>();
  const itemDist = new Map<string, number>();
  const teraDist = new Map<string, number>();
  const moveDist = new Map<string, number>();

  for (const [, role] of roleEntries) {
    accumulate(abilityDist, role.abilities, roleWeight);
    accumulate(itemDist, role.items, roleWeight);
    accumulate(teraDist, role.teraTypes, roleWeight);

    const poolSize = role.moves.length;
    const totalSlots = Math.min(4, poolSize);
    const revealedInRole = role.moves.filter((m) => revealedMoves.includes(toID(m)));
    const remainingSlots = totalSlots - revealedInRole.length;
    const remainingPool = role.moves.filter((m) => !revealedMoves.includes(toID(m)));
    if (remainingSlots > 0 && remainingPool.length > 0) {
      const p = remainingSlots / remainingPool.length;
      for (const move of remainingPool) {
        moveDist.set(move, (moveDist.get(move) ?? 0) + roleWeight * p);
      }
    }
  }

  return {
    speciesLookupKey: pokemon.speciesForme,
    found: true,
    level: speciesEntry.level,
    candidateRoleNames: roleEntries.map(([name]) => name),
    ability: {
      known: knownAbility,
      possible: knownAbility ? [{ name: knownAbility, probability: 1 }] : toSorted(abilityDist),
    },
    item: {
      known: knownItem,
      possible: knownItem ? [{ name: knownItem, probability: 1 }] : toSorted(itemDist),
    },
    teraType: {
      known: knownTera,
      possible: knownTera ? [{ name: knownTera, probability: 1 }] : toSorted(teraDist),
    },
    revealedMoves,
    possibleRemainingMoves: toSorted(moveDist),
  };
}

/**
 * Builds a small, probability-ranked list of complete concrete sets (role +
 * ability + item + stats) to actually run through the damage calculator.
 * We cap the number of scenarios so the UI stays readable even for species
 * with many roles/items.
 */
export function buildSetCandidates(
  pokemon: PokemonRevealState,
  repo: RandbatsRepository,
  maxCandidates = 5
): SetCandidate[] {
  const speciesEntry = repo.lookup(pokemon.speciesForme) ?? repo.lookup(pokemon.baseSpeciesName);
  if (!speciesEntry) return [];

  const revealedMoves = pokemon.moveIds.filter(Boolean);
  const knownAbility = pokemon.ability || undefined;
  const knownItem = pokemon.item || pokemon.lastItem || undefined;

  let roleEntries = Object.entries(speciesEntry.roles).filter(([, role]) =>
    roleMatches(role, { knownAbility, knownItem, knownTera: undefined, revealedMoves })
  );
  if (roleEntries.length === 0) roleEntries = Object.entries(speciesEntry.roles);

  const roleWeight = 1 / roleEntries.length;
  const candidates: SetCandidate[] = [];

  for (const [roleName, role] of roleEntries) {
    // knownAbility/knownItem come straight from @pkmn/client's live battle
    // state, which is always lowercase ID form ('protosynthesis'), not the
    // display-name form ('Protosynthesis') @smogon/calc's hasAbility()/
    // hasItem() require. Once a candidate matches (hasId already normalizes
    // both sides via toID), pick the *role's own* display-name spelling
    // rather than the raw known value -- otherwise every confirmed/revealed
    // opponent ability or item would silently stop affecting the damage
    // calc the moment it's actually known, which is exactly the case where
    // this should be most accurate.
    const abilities = knownAbility && hasId(role.abilities, knownAbility)
      ? [role.abilities.find((a) => toID(a) === toID(knownAbility))!]
      : role.abilities;
    const items = knownItem && hasId(role.items, knownItem)
      ? [role.items.find((i) => toID(i) === toID(knownItem))!]
      : role.items;
    for (const ability of abilities) {
      for (const item of items) {
        candidates.push({
          roleName,
          probability: roleWeight / (abilities.length * items.length),
          ability,
          item,
          evs: { ...DEFAULT_EVS, ...role.evs },
          ivs: { ...DEFAULT_IVS, ...role.ivs },
          level: speciesEntry.level,
        });
      }
    }
  }

  candidates.sort((a, b) => b.probability - a.probability);
  return candidates.slice(0, maxCandidates);
}
