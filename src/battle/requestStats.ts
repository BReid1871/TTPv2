import type { Pokemon as ClientPokemon, Side as ClientSide, Battle } from '@pkmn/client';
import { toID } from '@pkmn/data';
import { calcGen } from '../calc/damage.js';

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

export interface RequestPokemonInfo {
  stats?: PartialStatsTable;
  /** Full moveset (display names) for one of your own team's Pokemon. */
  moves: string[];
  hp: number;
  maxhp: number;
}

/**
 * Maps each of your team's ClientPokemon to authoritative stats/moves/HP
 * straight from the most recent |request| payload, bypassing @pkmn/client's
 * own ClientPokemon.moveSlots/hp/maxhp for a bench Pokemon that hasn't been
 * sent out yet.
 *
 * Those ClientPokemon fields only get back-filled from a |request| for a
 * Pokemon @pkmn/client already has a matching record for from an earlier
 * turn (see Battle#update's `if (pokemon) {...} else { addPokemon(p) }`
 * split -- the assignments that set hp/maxhp/moveSlots live only in the
 * `if` branch). A Pokemon that's never been switched in has no such record
 * on the very first |request| of the battle, so it reads 0 HP and no moves
 * until a second |request| arrives one request later -- reading straight
 * from `battle.request` instead (same source, no intermediate state to lag)
 * sidesteps that entirely.
 */
export function getRequestInfo(battle: Battle, mySideObj: ClientSide): Map<ClientPokemon, RequestPokemonInfo> {
  const info = new Map<ClientPokemon, RequestPokemonInfo>();
  const request = battle.request;
  if (request?.side) {
    request.side.pokemon.forEach((rp, i) => {
      const clientMon = mySideObj.team[i];
      if (!clientMon) return;
      info.set(clientMon, {
        stats: rp.stats as PartialStatsTable | undefined,
        moves: rp.moves.map((id) => calcGen.moves.get(toID(id))?.name ?? id),
        hp: rp.hp,
        maxhp: rp.maxhp,
      });
    });
  }
  return info;
}
