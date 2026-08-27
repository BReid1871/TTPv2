import { Generations, Pokemon as CalcPokemon, Move as CalcMove, Field as CalcField, Side as CalcSide, calculate } from '@smogon/calc';
import type { Battle, Side as ClientSide } from '@pkmn/client';
import { DEFAULT_EVS, DEFAULT_IVS, type StatsTable } from '../randbats/setTracker.js';

export const calcGen = Generations.get(9);

export interface KnownSetInput {
  speciesForme: string;
  level: number;
  ability: string;
  item: string;
  status?: string;
  teraType?: string;
  isTerastallized?: boolean;
  /** exact final stats (unboosted), e.g. from the |request| payload */
  rawStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  boosts: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  currentHpFraction: number; // 0..1
}

export interface CandidateSetInput {
  speciesForme: string;
  level: number;
  ability: string;
  item: string;
  status?: string;
  teraType?: string;
  isTerastallized?: boolean;
  evs: StatsTable;
  ivs: StatsTable;
  boosts: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
}

const STATUS_MAP: Record<string, 'slp' | 'psn' | 'brn' | 'frz' | 'par' | 'tox'> = {
  slp: 'slp',
  psn: 'psn',
  brn: 'brn',
  frz: 'frz',
  par: 'par',
  tox: 'tox',
};

const PARADOX_ABILITIES = new Set(['protosynthesis', 'quarkdrive']);

function isParadoxAbility(abilityId: string): boolean {
  return PARADOX_ABILITIES.has(abilityId.toLowerCase().replace(/[^a-z]/g, ''));
}

export function buildKnownPokemon(name: string, set: KnownSetInput): CalcPokemon {
  const p = new CalcPokemon(calcGen, name, {
    level: set.level,
    ability: set.ability || undefined,
    item: set.item || undefined,
    nature: 'Serious',
    status: set.status ? STATUS_MAP[set.status] : undefined,
    teraType: set.isTerastallized ? (set.teraType as any) : undefined,
    curHP: Math.max(1, Math.round(set.rawStats.hp * set.currentHpFraction)),
    boostedStat: set.ability && isParadoxAbility(set.ability) ? 'auto' : undefined,
    // rawStats/stats below are overridden with the real |request| numbers
    // regardless, but @smogon/calc reads pokemon.evs directly for at least
    // one damage-relevant purpose beyond deriving rawStats (confirmed: an
    // otherwise-identical Pokemon differs measurably in computed damage
    // with evs left at the library's zero default vs set here) -- Random
    // Battle sets overwhelmingly use this flat spread (see setTracker.ts),
    // and we don't have the real per-stat EVs from |request|, so use it as
    // the closest available approximation rather than the wrong default of 0.
    evs: DEFAULT_EVS as any,
    ivs: DEFAULT_IVS as any,
  });
  p.rawStats = { ...set.rawStats } as any;
  p.stats = { ...set.rawStats } as any;
  p.boosts = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...set.boosts } as any;
  p.originalCurHP = Math.max(1, Math.round(set.rawStats.hp * set.currentHpFraction));
  return p;
}

export function buildCandidatePokemon(name: string, set: CandidateSetInput): CalcPokemon {
  const p = new CalcPokemon(calcGen, name, {
    level: set.level,
    ability: set.ability || undefined,
    item: set.item || undefined,
    nature: 'Serious',
    status: set.status ? STATUS_MAP[set.status] : undefined,
    teraType: set.isTerastallized ? (set.teraType as any) : undefined,
    evs: set.evs as any,
    ivs: set.ivs as any,
    boostedStat: set.ability && isParadoxAbility(set.ability) ? 'auto' : undefined,
  });
  p.boosts = { hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0, ...set.boosts } as any;
  return p;
}

/** Translate the live @pkmn/client field/side state into a @smogon/calc Field. */
export function buildField(battle: Battle, attackerSideId: 'p1' | 'p2'): CalcField {
  const field = battle.field;
  const attackerSide = attackerSideId === 'p1' ? battle.p1 : battle.p2;
  const defenderSide = attackerSideId === 'p1' ? battle.p2 : battle.p1;

  return new CalcField({
    gameType: 'Singles',
    weather: field.weather as any,
    terrain: field.terrain as any,
    isGravity: field.hasPseudoWeather('gravity' as any),
    isMagicRoom: field.hasPseudoWeather('magicroom' as any),
    isWonderRoom: field.hasPseudoWeather('wonderroom' as any),
    attackerSide: buildSideConditions(attackerSide),
    defenderSide: buildSideConditions(defenderSide),
  });
}

function buildSideConditions(side: ClientSide): CalcSide {
  const c = side.sideConditions;
  return new CalcSide({
    spikes: c['spikes']?.level ?? 0,
    isSR: !!c['stealthrock'],
    isReflect: !!c['reflect'],
    isLightScreen: !!c['lightscreen'],
    isAuroraVeil: !!c['auroraveil'],
    isTailwind: !!c['tailwind'],
    isSeeded: !!c['leechseed'],
    isFriendGuard: false,
    isBattery: false,
    isPowerSpot: false,
    isSteelySpirit: false,
    isHelpingHand: false,
    isFlowerGift: false,
    isProtected: false,
    isForesight: false,
    isSaltCured: false,
  });
}

export interface PlainSideConditions {
  spikes: number;
  isSR: boolean;
  isReflect: boolean;
  isLightScreen: boolean;
  isAuroraVeil: boolean;
  isTailwind: boolean;
}

export interface PlainFieldSnapshot {
  weather?: string;
  terrain?: string;
  isGravity: boolean;
  mySideConditions: PlainSideConditions;
  opponentSideConditions: PlainSideConditions;
}

function sideConditionsFromSnapshot(s: PlainSideConditions): CalcSide {
  return new CalcSide({
    spikes: s.spikes,
    isSR: s.isSR,
    isReflect: s.isReflect,
    isLightScreen: s.isLightScreen,
    isAuroraVeil: s.isAuroraVeil,
    isTailwind: s.isTailwind,
    isSeeded: false,
    isFriendGuard: false,
    isBattery: false,
    isPowerSpot: false,
    isSteelySpirit: false,
    isHelpingHand: false,
    isFlowerGift: false,
    isProtected: false,
    isForesight: false,
    isSaltCured: false,
  });
}

/** Same as buildField, but reconstructed from a plain snapshot (see
 * src/battle/damageEvidence.ts) instead of a live Battle -- used to replay
 * historical evidence exactly as the field looked at the time it happened. */
export function buildFieldFromSnapshot(snapshot: PlainFieldSnapshot, attackerIsMe: boolean): CalcField {
  const attackerSide = attackerIsMe ? snapshot.mySideConditions : snapshot.opponentSideConditions;
  const defenderSide = attackerIsMe ? snapshot.opponentSideConditions : snapshot.mySideConditions;
  return new CalcField({
    gameType: 'Singles',
    weather: snapshot.weather as any,
    terrain: snapshot.terrain as any,
    isGravity: snapshot.isGravity,
    attackerSide: sideConditionsFromSnapshot(attackerSide),
    defenderSide: sideConditionsFromSnapshot(defenderSide),
  });
}

export interface MoveDamageResult {
  moveName: string;
  minPercent: number;
  maxPercent: number;
  koChance?: string;
}

/** Computes min/max damage as a percentage of the defender's max HP. */
export function computeMoveDamage(attacker: CalcPokemon, defender: CalcPokemon, moveName: string, field: CalcField): MoveDamageResult | undefined {
  try {
    const move = new CalcMove(calcGen, moveName);
    if (move.category === 'Status' || move.bp === 0) return undefined;
    const result = calculate(calcGen, attacker, defender, move, field);
    const [min, max] = result.range();
    const maxHp = defender.maxHP();
    const minPercent = Math.min(100, (min / maxHp) * 100);
    const maxPercent = Math.min(100, (max / maxHp) * 100);
    // result.kochance() (and .desc(), which we don't use) throws for a
    // guaranteed-0-damage hit (e.g. a full type immunity) instead of
    // reporting "won't KO" -- that's a real outcome, not a calc error, so
    // it must not fall through to the outer catch and drop the whole move.
    let koChance: string | undefined;
    try {
      koChance = result.kochance().text;
    } catch {
      koChance = undefined;
    }
    return {
      moveName,
      minPercent,
      maxPercent,
      koChance,
    };
  } catch (err) {
    return undefined;
  }
}
