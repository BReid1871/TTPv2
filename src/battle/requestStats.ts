import type { Pokemon as ClientPokemon, Side as ClientSide, Battle } from '@pkmn/client';

export type PartialStatsTable = { atk: number; def: number; spa: number; spd: number; spe: number };

/** Maps each of your team's ClientPokemon to its exact non-HP stats from the
 * most recent |request| payload -- the only place exact stats for your own
 * team are available (everything else is estimated from base stats). */
export function getRequestStats(battle: Battle, mySideObj: ClientSide): Map<ClientPokemon, PartialStatsTable> {
  const requestStats = new Map<ClientPokemon, PartialStatsTable>();
  const request = battle.request;
  if (request?.side) {
    request.side.pokemon.forEach((rp, i) => {
      const clientMon = mySideObj.team[i];
      if (clientMon && rp.stats) requestStats.set(clientMon, rp.stats as any);
    });
  }
  return requestStats;
}
