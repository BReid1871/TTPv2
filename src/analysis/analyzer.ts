import type { Pokemon as ClientPokemon, Side as ClientSide } from '@pkmn/client';
import type { Pokemon as CalcPokemon } from '@smogon/calc';
import type { ID } from '@pkmn/data';
import type { BattleSession } from '../battle/battleSession.js';
import type { RandbatsRepository } from '../randbats/data.js';
import { narrowSet, buildSetCandidates, type PokemonRevealState, type SetCandidate } from '../randbats/setTracker.js';
import { buildKnownPokemon, buildCandidatePokemon, buildField, computeMoveDamage } from '../calc/damage.js';
import { compareSpeed } from '../calc/speed.js';
import type { AnalysisReport, MoveDamageReport, OpponentSetInfo, PokemonMatchup, SpeedReport, YourPokemonInfo } from './types.js';

const MAX_CANDIDATE_SCENARIOS = 5;
const MIN_MOVE_PROBABILITY_TO_SHOW = 0.08;

function toRevealState(p: ClientPokemon): PokemonRevealState {
  return {
    speciesForme: p.speciesForme,
    baseSpeciesName: p.baseSpecies.name,
    level: p.level,
    ability: p.ability ?? '',
    item: p.item ?? '',
    lastItem: p.lastItem ?? '',
    moveIds: p.moveSlots.map((m) => m.id),
    teraType: p.terastallized,
  };
}

function pickBoosts(p: ClientPokemon) {
  const b = p.boosts;
  return { atk: b.atk ?? 0, def: b.def ?? 0, spa: b.spa ?? 0, spd: b.spd ?? 0, spe: b.spe ?? 0 };
}

function hpFraction(p: ClientPokemon): number {
  if (!p.maxhp) return 1;
  return Math.max(0, Math.min(1, p.hp / p.maxhp));
}

function toYourInfo(p: ClientPokemon, isActive: boolean): YourPokemonInfo {
  return {
    ident: p.ident,
    species: p.speciesForme,
    hpPercent: Math.round(hpFraction(p) * 100),
    status: p.status,
    fainted: p.fainted,
    isActive,
  };
}

function toOpponentInfo(p: ClientPokemon, repo: RandbatsRepository, isActive: boolean): OpponentSetInfo {
  const reveal = toRevealState(p);
  const narrowed = narrowSet(reveal, repo);
  return {
    ident: p.ident,
    species: p.speciesForme,
    level: p.level,
    hpPercent: Math.round(hpFraction(p) * 100),
    status: p.status,
    fainted: p.fainted,
    isActive,
    dataFound: narrowed.found,
    candidateRoles: narrowed.candidateRoleNames,
    ability: narrowed.ability,
    item: narrowed.item,
    teraType: narrowed.teraType,
    revealedMoves: narrowed.revealedMoves,
    possibleRemainingMoves: narrowed.possibleRemainingMoves.filter((m) => m.probability >= MIN_MOVE_PROBABILITY_TO_SHOW),
  };
}

/** Build the exact calc.Pokemon for one of *your* team members, using the
 * server-authoritative |request| stats rather than any estimate. */
function buildYourCalcPokemon(p: ClientPokemon, stats?: { atk: number; def: number; spa: number; spd: number; spe: number }): CalcPokemon {
  const rawStats = stats
    ? { hp: p.maxhp || 1, ...stats }
    : { hp: p.maxhp || 1, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };
  return buildKnownPokemon(p.speciesForme, {
    speciesForme: p.speciesForme,
    level: p.level,
    ability: p.ability,
    item: p.item,
    status: p.status,
    teraType: p.terastallized,
    isTerastallized: !!p.terastallized,
    rawStats,
    boosts: pickBoosts(p),
    currentHpFraction: hpFraction(p),
  });
}

function buildOpponentCandidateCalcPokemon(p: ClientPokemon, candidate: SetCandidate): CalcPokemon {
  return buildCandidatePokemon(p.speciesForme, {
    speciesForme: p.speciesForme,
    level: candidate.level,
    ability: candidate.ability,
    item: candidate.item,
    status: p.status,
    teraType: p.terastallized,
    isTerastallized: !!p.terastallized,
    evs: candidate.evs,
    ivs: candidate.ivs,
    boosts: pickBoosts(p),
  });
}

interface CandidateScenario {
  label: string;
  probability: number;
  calcPokemon: CalcPokemon;
}

function buildOpponentScenarios(p: ClientPokemon, repo: RandbatsRepository): CandidateScenario[] {
  const reveal = toRevealState(p);
  const candidates = buildSetCandidates(reveal, repo, MAX_CANDIDATE_SCENARIOS);
  if (candidates.length === 0) {
    // Unknown to randbats data (e.g. not a Random Battle format, or a
    // species missing from the set): fall back to a "bare" Pokemon using
    // only what's actually been revealed, at a plausible flat level 100.
    const fallback = buildOpponentCandidateCalcPokemon(p, {
      roleName: 'unknown',
      probability: 1,
      ability: p.ability,
      item: p.item || p.lastItem,
      evs: { hp: 84, atk: 84, def: 84, spa: 84, spd: 84, spe: 84 },
      ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
      level: p.level || 100,
    });
    return [{ label: 'best guess', probability: 1, calcPokemon: fallback }];
  }
  return candidates.map((c) => ({
    label: `${c.roleName} (${c.ability}${c.item ? `, ${c.item}` : ''})`,
    probability: c.probability,
    calcPokemon: buildOpponentCandidateCalcPokemon(p, c),
  }));
}

/** Damage from a fixed attacker into a set of candidate defender scenarios. */
function movesVsCandidateDefenders(
  moves: Array<{ name: string; confirmed: boolean; probability?: number }>,
  attacker: CalcPokemon,
  defenderScenarios: CandidateScenario[],
  field: ReturnType<typeof buildField>
): MoveDamageReport[] {
  const reports: MoveDamageReport[] = [];
  for (const move of moves) {
    let min = Infinity;
    let max = -Infinity;
    let mostLikely: number | undefined;
    let mostLikelyProb = -1;
    let koChance: string | undefined;
    for (const scenario of defenderScenarios) {
      const result = computeMoveDamage(attacker, scenario.calcPokemon, move.name, field);
      if (!result) continue;
      min = Math.min(min, result.minPercent);
      max = Math.max(max, result.maxPercent);
      if (scenario.probability > mostLikelyProb) {
        mostLikelyProb = scenario.probability;
        mostLikely = (result.minPercent + result.maxPercent) / 2;
        koChance = result.koChance;
      }
    }
    if (min === Infinity) continue; // status move or calc failure
    reports.push({
      name: move.name,
      minPercent: round1(min),
      maxPercent: round1(max),
      mostLikelyPercent: mostLikely !== undefined ? round1(mostLikely) : undefined,
      koChance,
      confirmed: move.confirmed,
      probability: move.probability,
    });
  }
  return reports.sort((a, b) => (b.mostLikelyPercent ?? b.maxPercent) - (a.mostLikelyPercent ?? a.maxPercent));
}

/** Damage from a set of candidate attacker scenarios into a fixed defender. */
function movesFromCandidateAttackers(
  moves: Array<{ name: string; confirmed: boolean; probability?: number }>,
  attackerScenarios: CandidateScenario[],
  defender: CalcPokemon,
  field: ReturnType<typeof buildField>
): MoveDamageReport[] {
  const reports: MoveDamageReport[] = [];
  for (const move of moves) {
    let min = Infinity;
    let max = -Infinity;
    let mostLikely: number | undefined;
    let mostLikelyProb = -1;
    let koChance: string | undefined;
    for (const scenario of attackerScenarios) {
      const result = computeMoveDamage(scenario.calcPokemon, defender, move.name, field);
      if (!result) continue;
      min = Math.min(min, result.minPercent);
      max = Math.max(max, result.maxPercent);
      if (scenario.probability > mostLikelyProb) {
        mostLikelyProb = scenario.probability;
        mostLikely = (result.minPercent + result.maxPercent) / 2;
        koChance = result.koChance;
      }
    }
    if (min === Infinity) continue;
    reports.push({
      name: move.name,
      minPercent: round1(min),
      maxPercent: round1(max),
      mostLikelyPercent: mostLikely !== undefined ? round1(mostLikely) : undefined,
      koChance,
      confirmed: move.confirmed,
      probability: move.probability,
    });
  }
  return reports.sort((a, b) => (b.mostLikelyPercent ?? b.maxPercent) - (a.mostLikelyPercent ?? a.maxPercent));
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function buildSpeedReport(
  yourCalcPokemon: CalcPokemon,
  opponentScenarios: CandidateScenario[],
  session: BattleSession,
  yourSideId: 'p1' | 'p2'
): SpeedReport {
  const field = buildField(session.battle, yourSideId);
  const yourSide = yourSideId === 'p1' ? field.attackerSide : field.defenderSide;
  const opponentSide = yourSideId === 'p1' ? field.defenderSide : field.attackerSide;
  const trickRoomActive = session.battle.field.hasPseudoWeather('trickroom' as ID);

  let opponentMin = Infinity;
  let opponentMax = -Infinity;
  let mostLikely = 0;
  let mostLikelyProb = -1;
  let yourSpeed = 0;

  for (const scenario of opponentScenarios) {
    const cmp = compareSpeed(yourCalcPokemon, yourSide, scenario.calcPokemon, opponentSide, field, trickRoomActive);
    yourSpeed = cmp.yourSpeed;
    opponentMin = Math.min(opponentMin, cmp.opponentSpeed);
    opponentMax = Math.max(opponentMax, cmp.opponentSpeed);
    if (scenario.probability > mostLikelyProb) {
      mostLikelyProb = scenario.probability;
      mostLikely = cmp.opponentSpeed;
    }
  }
  if (opponentMin === Infinity) {
    yourSpeed = compareSpeed(yourCalcPokemon, yourSide, yourCalcPokemon, opponentSide, field, trickRoomActive).yourSpeed;
    opponentMin = yourSpeed;
    opponentMax = yourSpeed;
  }

  const fasterVs = (oppSpeed: number) => (trickRoomActive ? yourSpeed < oppSpeed : yourSpeed > oppSpeed);

  return {
    yourSpeed,
    opponentSpeedRange: [opponentMin, opponentMax],
    opponentSpeedMostLikely: mostLikely,
    // "worst case" for you = the opponent speed value least favorable to you
    youAreFasterWorstCase: trickRoomActive ? fasterVs(opponentMin) : fasterVs(opponentMax),
    youAreFasterBestCase: trickRoomActive ? fasterVs(opponentMax) : fasterVs(opponentMin),
    youAreFasterMostLikely: fasterVs(mostLikely),
    trickRoomActive,
  };
}

function buildMatchup(
  yourPokemon: ClientPokemon,
  opponentPokemon: ClientPokemon,
  session: BattleSession,
  yourSideId: 'p1' | 'p2',
  repo: RandbatsRepository,
  requestStats: Map<ClientPokemon, { atk: number; def: number; spa: number; spd: number; spe: number }>,
  isYoursActive: boolean,
  isOpponentActive: boolean
): PokemonMatchup {
  const field = buildField(session.battle, yourSideId);
  const yourCalc = buildYourCalcPokemon(yourPokemon, requestStats.get(yourPokemon));
  const opponentScenarios = buildOpponentScenarios(opponentPokemon, repo);

  const yourMoves = yourPokemon.moveSlots.map((m) => ({ name: m.name, confirmed: true }));
  const opponentInfo = toOpponentInfo(opponentPokemon, repo, isOpponentActive);
  const opponentMoveList = [
    ...opponentInfo.revealedMoves.map((name) => ({ name, confirmed: true })),
    ...opponentInfo.possibleRemainingMoves.map((m) => ({ name: m.name, confirmed: false, probability: m.probability })),
  ];

  return {
    yours: toYourInfo(yourPokemon, isYoursActive),
    opponent: opponentInfo,
    yourMovesVsOpponent: movesVsCandidateDefenders(yourMoves, yourCalc, opponentScenarios, field),
    opponentMovesVsYou: movesFromCandidateAttackers(opponentMoveList, opponentScenarios, yourCalc, field),
    speed: buildSpeedReport(yourCalc, opponentScenarios, session, yourSideId),
  };
}

export function analyzeBattle(session: BattleSession, repo: RandbatsRepository): AnalysisReport {
  const base: AnalysisReport = {
    roomid: session.roomid,
    turn: session.battle.turn,
    generatedAt: Date.now(),
    format: session.battle.tier || '',
    waiting: true,
    bench: [],
    opponentRevealedBench: [],
  };

  if (!session.mySide || (session.mySide !== 'p1' && session.mySide !== 'p2')) {
    return { ...base, waitingReason: 'Waiting to confirm which side is yours...' };
  }
  const mySideId: 'p1' | 'p2' = session.mySide;

  const mySideObj: ClientSide = mySideId === 'p1' ? session.battle.p1 : session.battle.p2;
  const foeSideObj: ClientSide = mySideId === 'p1' ? session.battle.p2 : session.battle.p1;

  const myActive = mySideObj.active[0];
  const foeActive = foeSideObj.active[0];

  if (!myActive || !foeActive || myActive.fainted || foeActive.fainted) {
    return { ...base, waitingReason: 'Waiting for both sides to have an active Pokemon...' };
  }

  const requestStats = new Map<ClientPokemon, { atk: number; def: number; spa: number; spd: number; spe: number }>();
  const request = session.battle.request;
  if (request?.side) {
    request.side.pokemon.forEach((rp, i) => {
      const clientMon = mySideObj.team[i];
      if (clientMon && rp.stats) requestStats.set(clientMon, rp.stats as any);
    });
  }

  const active = buildMatchup(myActive, foeActive, session, mySideId, repo, requestStats, true, true);

  const bench = mySideObj.team
    .filter((p) => p !== myActive && !p.fainted)
    .map((p) => buildMatchup(p, foeActive, session, mySideId, repo, requestStats, false, true));

  const opponentRevealedBench = foeSideObj.team
    .filter((p) => p !== foeActive && !p.fainted)
    .map((p) => toOpponentInfo(p, repo, false));

  return {
    ...base,
    waiting: false,
    active,
    bench,
    opponentRevealedBench,
  };
}
