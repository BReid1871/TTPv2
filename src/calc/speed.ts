import type { Pokemon as CalcPokemon, Field as CalcField, Side as CalcSide } from '@smogon/calc';

const MODERN_BOOST_TABLE: Array<[number, number]> = [
  [2, 8],
  [2, 7],
  [2, 6],
  [2, 5],
  [2, 4],
  [2, 3],
  [2, 2],
  [3, 2],
  [4, 2],
  [5, 2],
  [6, 2],
  [7, 2],
  [8, 2],
];

function getModifiedStat(stat: number, boost: number): number {
  const clamped = Math.max(-6, Math.min(6, boost));
  const [num, den] = MODERN_BOOST_TABLE[6 + clamped];
  return Math.floor(Math.floor(stat * num) / den);
}

function pokeRound(num: number): number {
  return num % 1 > 0.5 ? Math.ceil(num) : Math.floor(num);
}

function chainMods(mods: number[]): number {
  let m = 4096;
  for (const mod of mods) {
    if (mod !== 4096) m = (m * mod + 2048) >> 12;
  }
  return Math.max(0, m);
}

function getQPBoostedStat(pokemon: CalcPokemon): 'atk' | 'def' | 'spa' | 'spd' | 'spe' {
  if (pokemon.boostedStat && pokemon.boostedStat !== 'auto') return pokemon.boostedStat;
  let best: 'atk' | 'def' | 'spa' | 'spd' | 'spe' = 'atk';
  for (const stat of ['def', 'spa', 'spd', 'spe'] as const) {
    if (getModifiedStat(pokemon.rawStats[stat], pokemon.boosts[stat]) > getModifiedStat(pokemon.rawStats[best], pokemon.boosts[best])) {
      best = stat;
    }
  }
  return best;
}

function isQuarkProtoActive(pokemon: CalcPokemon, field: CalcField): boolean {
  if (!pokemon.boostedStat) return false;
  const weather = field.weather ?? '';
  const terrain = field.terrain;
  return (
    (pokemon.hasAbility('Protosynthesis') && (weather.includes('Sun') || pokemon.hasItem('Booster Energy'))) ||
    (pokemon.hasAbility('Quark Drive') && (terrain === 'Electric' || pokemon.hasItem('Booster Energy'))) ||
    pokemon.boostedStat !== 'auto'
  );
}

/**
 * Ported from @smogon/calc's internal `getFinalSpeed` mechanics (gen 7-9) so
 * we can rank Pokemon by real effective speed -- boosts, Tailwind, weather-
 * and terrain-boosting abilities, Choice Scarf / Iron Ball, paralysis, and
 * the Paradox "highest raw stat" speed boost -- using the exact same
 * @smogon/calc Pokemon/Field/Side objects the damage calc already builds.
 */
export function getFinalSpeed(pokemon: CalcPokemon, field: CalcField, side: CalcSide): number {
  let speed = getModifiedStat(pokemon.rawStats.spe, pokemon.boosts.spe);
  const mods: number[] = [];

  if (side.isTailwind) mods.push(8192);

  if (
    (pokemon.hasAbility('Unburden') && pokemon.abilityOn) ||
    (pokemon.hasAbility('Chlorophyll') && (field.weather ?? '').includes('Sun')) ||
    (pokemon.hasAbility('Sand Rush') && field.weather === 'Sand') ||
    (pokemon.hasAbility('Swift Swim') && (field.weather ?? '').includes('Rain')) ||
    (pokemon.hasAbility('Slush Rush') && (field.weather === 'Hail' || field.weather === 'Snow')) ||
    (pokemon.hasAbility('Surge Surfer') && field.terrain === 'Electric')
  ) {
    mods.push(8192);
  } else if (pokemon.hasAbility('Quick Feet') && pokemon.status) {
    mods.push(6144);
  } else if (pokemon.hasAbility('Slow Start') && pokemon.abilityOn) {
    mods.push(2048);
  } else if (isQuarkProtoActive(pokemon, field) && getQPBoostedStat(pokemon) === 'spe') {
    mods.push(6144);
  }

  if (!(pokemon.hasAbility('Unburden') && pokemon.abilityOn)) {
    if (pokemon.hasItem('Choice Scarf')) {
      mods.push(6144);
    } else if (pokemon.hasItem('Iron Ball')) {
      mods.push(2048);
    } else if (pokemon.hasItem('Quick Powder') && pokemon.named('Ditto')) {
      mods.push(8192);
    }
  }

  speed = pokeRound((speed * chainMods(mods)) / 4096);

  if (pokemon.hasStatus('par') && !pokemon.hasAbility('Quick Feet')) {
    speed = Math.floor((speed * 50) / 100);
  }

  return Math.max(0, Math.min(10000, speed));
}

export interface SpeedComparison {
  yourSpeed: number;
  opponentSpeed: number;
  youAreFaster: boolean;
  tied: boolean;
  trickRoomActive: boolean;
}

export function compareSpeed(
  yours: CalcPokemon,
  yourSide: CalcSide,
  opponent: CalcPokemon,
  opponentSide: CalcSide,
  field: CalcField,
  trickRoomActive: boolean
): SpeedComparison {
  const yourSpeed = getFinalSpeed(yours, field, yourSide);
  const opponentSpeed = getFinalSpeed(opponent, field, opponentSide);
  const faster = trickRoomActive ? yourSpeed < opponentSpeed : yourSpeed > opponentSpeed;
  return {
    yourSpeed,
    opponentSpeed,
    youAreFaster: faster,
    tied: yourSpeed === opponentSpeed,
    trickRoomActive,
  };
}
