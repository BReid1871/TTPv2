import { Generations, toID } from '@pkmn/data';
import { Dex } from '@pkmn/dex';

// @smogon/calc's own move data (calcGen in calc/damage.ts) strips most flags
// down to just the ones its damage formula needs -- 'charge' isn't one of
// them -- so charge-move detection needs a plain @pkmn/data Generation
// instead, same source battleSession.ts already uses for the live client.
const dataGen = new Generations(Dex).get(9);

function isChargeMove(moveId: string): boolean {
  return !!dataGen.moves.get(toID(moveId))?.flags?.charge;
}

// Moves that skip their charge turn entirely under a specific weather.
// Not declared anywhere in the dex data (it's implemented as move-specific
// battle script, not a flag), so this is the whole list, hand-verified
// against each move's own description text.
const WEATHER_INSTANT: Record<string, string[]> = {
  solarbeam: ['Sun', 'Harsh Sunshine'],
  solarblade: ['Sun', 'Harsh Sunshine'],
  electroshot: ['Rain', 'Heavy Rain'],
};

/** For a two-turn move, whether using it right now would be instant (weather
 * match, or the attacker holding/possibly holding Power Herb) or take the
 * full two turns -- or undefined if this isn't a charge move at all. */
export function chargeNoticeFor(moveId: string, weather: string | undefined, attackerItem: { known?: string; possible?: { name: string; probability: number }[] }): string | undefined {
  const id = toID(moveId);
  if (!isChargeMove(id)) return undefined;

  const instantWeathers = WEATHER_INSTANT[id];
  if (instantWeathers && weather && instantWeathers.includes(weather)) {
    return `Instant this turn (${weather} active)`;
  }

  if (attackerItem.known) {
    return attackerItem.known === 'Power Herb' ? 'Instant this turn (Power Herb)' : 'Takes 2 turns to charge';
  }
  const powerHerbChance = attackerItem.possible?.find((o) => o.name === 'Power Herb')?.probability;
  if (powerHerbChance) {
    return `Takes 2 turns to charge (${Math.round(powerHerbChance * 100)}% chance it's holding Power Herb for an instant hit)`;
  }
  return 'Takes 2 turns to charge';
}

// Ground truth taken directly from each charge move's own dex description
// text (see the "avoids all attacks other than ..." wording), not memory:
// moveId -> (bypass moveId -> that move's real damage multiplier against it).
const SEMI_INVULNERABLE: Record<string, Map<string, number>> = {
  fly: new Map([['gust', 2], ['twister', 2], ['skyuppercut', 1], ['smackdown', 1], ['thousandarrows', 1], ['thunder', 1], ['hurricane', 1]]),
  bounce: new Map([['gust', 2], ['twister', 2], ['skyuppercut', 1], ['smackdown', 1], ['thousandarrows', 1], ['thunder', 1], ['hurricane', 1]]),
  dig: new Map([['earthquake', 2], ['magnitude', 2]]),
  dive: new Map([['surf', 2], ['whirlpool', 2]]),
  phantomforce: new Map(),
  shadowforce: new Map(),
};

/** Whether `chargingMoveName` (as sent by the server, e.g. 'Fly') grants
 * semi-invulnerability at all -- Solar Beam/Meteor Beam/etc. also have
 * flags.charge but don't hide the user, so this is a separate, smaller set. */
export function grantsSemiInvulnerability(chargingMoveName: string): boolean {
  return toID(chargingMoveName) in SEMI_INVULNERABLE;
}

/** How a specific move fares against a semi-invulnerable defender: 'immune'
 * (don't even bother calculating -- it just misses), a base-power
 * multiplier to feed into computeMoveDamage (1 for an unboosted bypass
 * move, 2 for Earthquake-vs-Dig etc.), or undefined if the defender isn't
 * semi-invulnerable / this isn't a state that grants it. */
export function semiInvulnerabilityOutcome(moveId: string, chargingMoveName: string | undefined): 'immune' | number | undefined {
  if (!chargingMoveName) return undefined;
  const bypassMoves = SEMI_INVULNERABLE[toID(chargingMoveName)];
  if (!bypassMoves) return undefined;
  return bypassMoves.get(toID(moveId)) ?? 'immune';
}
