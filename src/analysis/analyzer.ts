import type { Pokemon as ClientPokemon, Side as ClientSide } from '@pkmn/client';
import type { Pokemon as CalcPokemon } from '@smogon/calc';
import { toID, type ID } from '@pkmn/data';
import type { BattleSession } from '../battle/battleSession.js';
import { getRequestInfo, type RequestPokemonInfo } from '../battle/requestStats.js';
import type { RandbatsRepository } from '../randbats/data.js';
import { narrowSet, buildSetCandidates, type PokemonRevealState, type SetCandidate } from '../randbats/setTracker.js';
import { buildKnownPokemon, buildCandidatePokemon, buildField, computeMoveDamage, calcGen } from '../calc/damage.js';
import { compareSpeed } from '../calc/speed.js';
import type { AnalysisReport, MoveDamageReport, OpponentSetInfo, PokemonMatchup, SpeedReport, WeightedOption, YourPokemonInfo } from './types.js';
import type { DamageEvidence } from '../battle/damageEvidence.js';
import { filterCandidatesByEvidence, distributionFrom, roleNamesFrom } from './itemInference.js';
import { chargeNoticeFor, semiInvulnerabilityOutcome } from './chargeMoves.js';

const MAX_CANDIDATE_SCENARIOS = 5;
const MIN_MOVE_PROBABILITY_TO_SHOW = 0.08;

function toRevealState(p: ClientPokemon, choiceItemRuledOut = false): PokemonRevealState {
  return {
    speciesForme: p.speciesForme,
    baseSpeciesName: p.baseSpecies.name,
    level: p.level,
    ability: p.ability ?? '',
    item: p.item ?? '',
    lastItem: p.lastItem ?? '',
    moveIds: p.moveSlots.map((m) => m.id),
    teraType: p.terastallized,
    choiceItemRuledOut,
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

/** Prefer the authoritative |request| HP for one of *your* Pokemon over
 * ClientPokemon's own hp/maxhp -- see getRequestInfo's doc comment for why
 * those lag by one request for a bench Pokemon that hasn't been sent out
 * yet (reads as 0/0, i.e. hpFraction's "unknown -> assume full" fallback,
 * rather than the real value). */
function yourHpFraction(p: ClientPokemon, info: RequestPokemonInfo | undefined): number {
  if (info?.maxhp) return Math.max(0, Math.min(1, info.hp / info.maxhp));
  return hpFraction(p);
}

function toYourInfo(p: ClientPokemon, isActive: boolean, chargingMove: string | undefined, info: RequestPokemonInfo | undefined): YourPokemonInfo {
  return {
    ident: p.ident,
    species: p.speciesForme,
    hpPercent: Math.round(yourHpFraction(p, info) * 100),
    status: p.status,
    fainted: p.fainted,
    isActive,
    chargingMove,
  };
}

/** narrowSet operates on @pkmn/client's internal IDs (e.g. 'headlongrush'); map
 * back to display names (e.g. 'Headlong Rush') for anything shown to the user. */
function displayMoveName(id: string): string {
  return calcGen.moves.get(toID(id))?.name ?? id;
}
function displayAbilityName(id: string): string {
  return calcGen.abilities.get(toID(id))?.name ?? id;
}
function displayItemName(id: string): string {
  return calcGen.items.get(toID(id))?.name ?? id;
}

function toOpponentInfo(p: ClientPokemon, repo: RandbatsRepository, isActive: boolean, evidence: DamageEvidence[], choiceItemRuledOut = false, chargingMove?: string): OpponentSetInfo {
  const reveal = toRevealState(p, choiceItemRuledOut);
  const narrowed = narrowSet(reveal, repo);

  // Structural narrowing (ability/item/moves already revealed) comes from
  // narrowSet above. On top of that, cross-check accumulated damage
  // evidence against every remaining candidate and drop whichever ones
  // couldn't have produced an observed hit -- e.g. a Choice Band-only
  // amount of damage rules out every non-Choice-Band item candidate. Only
  // applied when the field isn't already directly confirmed (a real reveal
  // always wins over an inference).
  let candidateRoles = narrowed.candidateRoleNames;
  let ability = narrowed.ability;
  let item = narrowed.item;
  if (evidence.length > 0 && (!narrowed.ability.known || !narrowed.item.known)) {
    const allCandidates = buildSetCandidates(reveal, repo, Infinity);
    const survivors = filterCandidatesByEvidence(allCandidates, evidence);
    if (survivors.length < allCandidates.length) {
      candidateRoles = roleNamesFrom(survivors);
      if (!narrowed.ability.known) ability = { known: undefined, possible: distributionFrom(survivors, (c) => displayAbilityName(c.ability)) };
      if (!narrowed.item.known) item = { known: undefined, possible: distributionFrom(survivors, (c) => displayItemName(c.item)) };
    }
  }

  return {
    ident: p.ident,
    species: p.speciesForme,
    level: p.level,
    hpPercent: Math.round(hpFraction(p) * 100),
    status: p.status,
    fainted: p.fainted,
    isActive,
    dataFound: narrowed.found,
    candidateRoles,
    ability: { ...ability, known: ability.known ? displayAbilityName(ability.known) : undefined },
    item: { ...item, known: item.known ? displayItemName(item.known) : undefined },
    teraType: narrowed.teraType,
    revealedMoves: narrowed.revealedMoves.map(displayMoveName),
    possibleRemainingMoves: narrowed.possibleRemainingMoves.filter((m) => m.probability >= MIN_MOVE_PROBABILITY_TO_SHOW),
    chargingMove,
  };
}

/** Build the exact calc.Pokemon for one of *your* team members, using the
 * server-authoritative |request| stats/HP rather than any estimate -- see
 * getRequestInfo's doc comment for why request-derived HP (not
 * ClientPokemon's own maxhp) matters here specifically.
 *
 * `teraOverride`: build this Pokemon as if already Terastallized into the
 * given type, regardless of whether it actually has yet -- used to evaluate
 * a hypothetical "what if I Terastallize this turn" line (see
 * recommendAction.ts's tera-flip check) without needing a second code path.
 * Defaults to the real, already-Terastallized state (`p.terastallized`). */
export function buildYourCalcPokemon(p: ClientPokemon, info?: RequestPokemonInfo, teraOverride?: string): CalcPokemon {
  const maxHp = info?.maxhp || p.maxhp || 1;
  const rawStats = info?.stats
    ? { hp: maxHp, ...info.stats }
    : { hp: maxHp, atk: 1, def: 1, spa: 1, spd: 1, spe: 1 };
  const teraType = teraOverride ?? p.terastallized;
  return buildKnownPokemon(p.speciesForme, {
    speciesForme: p.speciesForme,
    level: p.level,
    // @smogon/calc's hasAbility()/hasItem() do exact-string matching against
    // display names ('Life Orb'), not @pkmn/client's lowercase IDs
    // ('lifeorb') -- passing the ID form silently disables every held-item
    // and ability effect (Choice items, Life Orb, Assault Vest, Supreme
    // Overlord, ...) for your own team's damage calc without ever erroring.
    ability: p.ability ? displayAbilityName(p.ability) : p.ability,
    item: p.item ? displayItemName(p.item) : p.item,
    status: p.status,
    teraType,
    isTerastallized: !!teraType,
    rawStats,
    boosts: pickBoosts(p),
    currentHpFraction: yourHpFraction(p, info),
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
    currentHpFraction: hpFraction(p),
  });
}

export interface CandidateScenario {
  label: string;
  probability: number;
  calcPokemon: CalcPokemon;
}

export function buildOpponentScenarios(p: ClientPokemon, repo: RandbatsRepository, evidence: DamageEvidence[], choiceItemRuledOut = false): CandidateScenario[] {
  const reveal = toRevealState(p, choiceItemRuledOut);
  const candidates = filterCandidatesByEvidence(buildSetCandidates(reveal, repo, MAX_CANDIDATE_SCENARIOS), evidence);
  if (candidates.length === 0) {
    // Unknown to randbats data (e.g. not a Random Battle format, or a
    // species missing from the set): fall back to a "bare" Pokemon using
    // only what's actually been revealed, at a plausible flat level 100.
    // p.ability/p.item are @pkmn/client's lowercase ID form ('lifeorb'), not
    // the display-name form ('Life Orb') @smogon/calc's hasAbility()/
    // hasItem() require -- same trap fixed for buildKnownPokemon and
    // buildSetCandidates elsewhere in this codebase.
    const fallback = buildOpponentCandidateCalcPokemon(p, {
      roleName: 'unknown',
      probability: 1,
      ability: p.ability ? displayAbilityName(p.ability) : p.ability,
      item: p.item || p.lastItem ? displayItemName(p.item || p.lastItem) : '',
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

/** Many candidate scenarios (different ability/item combos) land on the exact
 * same damage range -- e.g. an item that doesn't touch the relevant offense/
 * defense stat at all -- so "most likely" has to sum probability across every
 * scenario that produced a given (min, max) and pick the highest total,
 * rather than just taking the single highest-probability scenario with ties
 * broken by array order (which silently depends on how the upstream data
 * happened to order otherwise-equivalent candidates). */
function pickMostLikelyOutcome(
  outcomes: Array<{ probability: number; minPercent: number; maxPercent: number; koChance?: string }>
): { mostLikely?: number; koChance?: string } {
  const grouped = new Map<string, { probability: number; minPercent: number; maxPercent: number; koChance?: string }>();
  for (const o of outcomes) {
    const key = `${o.minPercent}|${o.maxPercent}`;
    const existing = grouped.get(key);
    if (existing) existing.probability += o.probability;
    else grouped.set(key, { ...o });
  }
  let best: { probability: number; minPercent: number; maxPercent: number; koChance?: string } | undefined;
  for (const g of grouped.values()) {
    if (!best || g.probability > best.probability) best = g;
  }
  return best ? { mostLikely: (best.minPercent + best.maxPercent) / 2, koChance: best.koChance } : {};
}

interface AttackerItemInfo {
  known?: string;
  possible?: WeightedOption[];
}

/** Damage from a fixed attacker into a set of candidate defender scenarios.
 * `defenderChargingMove` is the move (e.g. 'Fly') the defender is currently
 * mid-charge on, if any -- moves that can't hit a semi-invulnerable target
 * are reported as a flat 0%/0% ("it just misses") rather than their normal,
 * misleading full-HP damage range; a bypass move (Earthquake vs. Dig, ...)
 * gets its real base-power bonus folded into the same calculate() call so
 * the reported range and koChance stay consistent with each other. */
function movesVsCandidateDefenders(
  moves: Array<{ name: string; confirmed: boolean; probability?: number }>,
  attacker: CalcPokemon,
  defenderScenarios: CandidateScenario[],
  field: ReturnType<typeof buildField>,
  weather: string | undefined,
  attackerItem: AttackerItemInfo,
  defenderChargingMove: string | undefined
): MoveDamageReport[] {
  const reports: MoveDamageReport[] = [];
  for (const move of moves) {
    const chargeNotice = chargeNoticeFor(move.name, weather, attackerItem);
    const semiInvuln = semiInvulnerabilityOutcome(move.name, defenderChargingMove);
    if (semiInvuln === 'immune') {
      reports.push({ name: move.name, minPercent: 0, maxPercent: 0, confirmed: move.confirmed, probability: move.probability, chargeNotice });
      continue;
    }
    const basePowerMultiplier = typeof semiInvuln === 'number' ? semiInvuln : 1;
    let min = Infinity;
    let max = -Infinity;
    const outcomes: Array<{ probability: number; minPercent: number; maxPercent: number; koChance?: string }> = [];
    for (const scenario of defenderScenarios) {
      const result = computeMoveDamage(attacker, scenario.calcPokemon, move.name, field, basePowerMultiplier);
      if (!result) continue;
      min = Math.min(min, result.minPercent);
      max = Math.max(max, result.maxPercent);
      outcomes.push({ probability: scenario.probability, minPercent: result.minPercent, maxPercent: result.maxPercent, koChance: result.koChance });
    }
    if (min === Infinity) continue; // status move or calc failure
    const { mostLikely, koChance } = pickMostLikelyOutcome(outcomes);
    reports.push({
      name: move.name,
      minPercent: round1(min),
      maxPercent: round1(max),
      mostLikelyPercent: mostLikely !== undefined ? round1(mostLikely) : undefined,
      koChance,
      confirmed: move.confirmed,
      probability: move.probability,
      chargeNotice,
    });
  }
  return reports.sort((a, b) => (b.mostLikelyPercent ?? b.maxPercent) - (a.mostLikelyPercent ?? a.maxPercent));
}

/** Damage from a set of candidate attacker scenarios into a fixed defender.
 * Mirrors movesVsCandidateDefenders's semi-invulnerability handling, but for
 * the opposite direction (defenderChargingMove here is "am I -- the fixed
 * defender -- currently semi-invulnerable"). */
function movesFromCandidateAttackers(
  moves: Array<{ name: string; confirmed: boolean; probability?: number }>,
  attackerScenarios: CandidateScenario[],
  defender: CalcPokemon,
  field: ReturnType<typeof buildField>,
  weather: string | undefined,
  attackerItem: AttackerItemInfo,
  defenderChargingMove: string | undefined
): MoveDamageReport[] {
  const reports: MoveDamageReport[] = [];
  for (const move of moves) {
    const chargeNotice = chargeNoticeFor(move.name, weather, attackerItem);
    const semiInvuln = semiInvulnerabilityOutcome(move.name, defenderChargingMove);
    if (semiInvuln === 'immune') {
      reports.push({ name: move.name, minPercent: 0, maxPercent: 0, confirmed: move.confirmed, probability: move.probability, chargeNotice });
      continue;
    }
    const basePowerMultiplier = typeof semiInvuln === 'number' ? semiInvuln : 1;
    let min = Infinity;
    let max = -Infinity;
    const outcomes: Array<{ probability: number; minPercent: number; maxPercent: number; koChance?: string }> = [];
    for (const scenario of attackerScenarios) {
      const result = computeMoveDamage(scenario.calcPokemon, defender, move.name, field, basePowerMultiplier);
      if (!result) continue;
      min = Math.min(min, result.minPercent);
      max = Math.max(max, result.maxPercent);
      outcomes.push({ probability: scenario.probability, minPercent: result.minPercent, maxPercent: result.maxPercent, koChance: result.koChance });
    }
    if (min === Infinity) continue;
    const { mostLikely, koChance } = pickMostLikelyOutcome(outcomes);
    reports.push({
      name: move.name,
      minPercent: round1(min),
      maxPercent: round1(max),
      mostLikelyPercent: mostLikely !== undefined ? round1(mostLikely) : undefined,
      koChance,
      confirmed: move.confirmed,
      probability: move.probability,
      chargeNotice,
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
  let yourSpeed = 0;
  // Many candidate scenarios land on the exact same integer speed (most
  // items/abilities don't affect Speed at all), so "most likely" has to sum
  // probability across every scenario that produces a given speed and pick
  // the highest total -- taking the single highest-probability scenario
  // (with ties broken by array order) would silently depend on how the
  // upstream data happened to order otherwise-equivalent candidates.
  const speedProbability = new Map<number, number>();

  for (const scenario of opponentScenarios) {
    const cmp = compareSpeed(yourCalcPokemon, yourSide, scenario.calcPokemon, opponentSide, field, trickRoomActive);
    yourSpeed = cmp.yourSpeed;
    opponentMin = Math.min(opponentMin, cmp.opponentSpeed);
    opponentMax = Math.max(opponentMax, cmp.opponentSpeed);
    speedProbability.set(cmp.opponentSpeed, (speedProbability.get(cmp.opponentSpeed) ?? 0) + scenario.probability);
  }
  let mostLikely = 0;
  let mostLikelyProb = -1;
  for (const [speed, probability] of speedProbability) {
    if (probability > mostLikelyProb) {
      mostLikelyProb = probability;
      mostLikely = speed;
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

export function buildMatchup(
  yourPokemon: ClientPokemon,
  opponentPokemon: ClientPokemon,
  session: BattleSession,
  yourSideId: 'p1' | 'p2',
  repo: RandbatsRepository,
  requestInfo: Map<ClientPokemon, RequestPokemonInfo>,
  isYoursActive: boolean,
  isOpponentActive: boolean
): PokemonMatchup {
  const field = buildField(session.battle, yourSideId);
  const weather = session.battle.field.weather || undefined;
  const yourInfo = requestInfo.get(yourPokemon);
  const yourCalc = buildYourCalcPokemon(yourPokemon, yourInfo);
  const evidence = session.damageEvidence.getEvidence(opponentPokemon.speciesForme);
  const opponentChoiceItemRuledOut = session.choiceLock.ruledOutChoiceItem(opponentPokemon.ident);
  const opponentScenarios = buildOpponentScenarios(opponentPokemon, repo, evidence, opponentChoiceItemRuledOut);

  const yourChargingMove = session.chargeState.chargingMove(yourPokemon.ident);
  const opponentChargingMove = session.chargeState.chargingMove(opponentPokemon.ident);
  // your own item is always known exactly (unlike the opponent's, which is
  // only ever a probability distribution until revealed).
  const yourItem: AttackerItemInfo = { known: yourPokemon.item ? displayItemName(yourPokemon.item) : 'None' };

  // Prefer the |request|-derived moveset (yourInfo.moves) over
  // ClientPokemon.moveSlots -- see getRequestInfo's doc comment for why
  // moveSlots alone is unreliable for a bench Pokemon that hasn't been sent
  // out yet. Falls back to moveSlots only if no request info is available
  // at all (shouldn't normally happen once a battle has an active Pokemon).
  const yourMoveNames = yourInfo?.moves.length ? yourInfo.moves : yourPokemon.moveSlots.map((m) => m.name);
  const yourMoves = yourMoveNames.map((name) => ({ name, confirmed: true }));
  const opponentInfo = toOpponentInfo(opponentPokemon, repo, isOpponentActive, evidence, opponentChoiceItemRuledOut, opponentChargingMove);
  const opponentMoveList = [
    ...opponentInfo.revealedMoves.map((name) => ({ name, confirmed: true })),
    ...opponentInfo.possibleRemainingMoves.map((m) => ({ name: m.name, confirmed: false, probability: m.probability })),
  ];

  return {
    yours: toYourInfo(yourPokemon, isYoursActive, yourChargingMove, yourInfo),
    opponent: opponentInfo,
    yourMovesVsOpponent: movesVsCandidateDefenders(yourMoves, yourCalc, opponentScenarios, field, weather, yourItem, opponentChargingMove),
    opponentMovesVsYou: movesFromCandidateAttackers(opponentMoveList, opponentScenarios, yourCalc, field, weather, opponentInfo.item, yourChargingMove),
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

  const requestInfo = getRequestInfo(session.battle, mySideObj);

  const active = buildMatchup(myActive, foeActive, session, mySideId, repo, requestInfo, true, true);

  const bench = mySideObj.team
    .filter((p) => p !== myActive && !p.fainted)
    .map((p) => buildMatchup(p, foeActive, session, mySideId, repo, requestInfo, false, true));

  const opponentRevealedBench = foeSideObj.team
    .filter((p) => p !== foeActive && !p.fainted)
    .map((p) => toOpponentInfo(p, repo, false, session.damageEvidence.getEvidence(p.speciesForme), session.choiceLock.ruledOutChoiceItem(p.ident), session.chargeState.chargingMove(p.ident)));

  return {
    ...base,
    waiting: false,
    active,
    bench,
    opponentRevealedBench,
  };
}
