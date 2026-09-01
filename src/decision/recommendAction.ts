import { Generations, toID } from '@pkmn/data';
import { Dex } from '@pkmn/dex';
import type { Side as ClientSide, Pokemon as ClientPokemon } from '@pkmn/client';
import type { Pokemon as CalcPokemon, Field as CalcField } from '@smogon/calc';
import type { BattleSession } from '../battle/battleSession.js';
import { getRequestInfo } from '../battle/requestStats.js';
import type { RandbatsRepository } from '../randbats/data.js';
import { buildField, computeMoveDamage } from '../calc/damage.js';
import { buildYourCalcPokemon, buildOpponentScenarios, buildMatchup, type CandidateScenario } from '../analysis/analyzer.js';
import type { AnalysisReport, MoveDamageReport, PokemonMatchup } from '../analysis/types.js';
import { availableTurns, availableTurnsAfterSwitch, proposedOpponentTurns, isFavorable } from './availableTurns.js';
import { selfBoostsFor, bestAttackDamagePercent } from './boostedDamage.js';
import type { ActionEvaluation, RecommendedAction } from './types.js';

// Same source as boostedDamage.ts/chargeMoves.ts's dataGen -- @smogon/calc's
// own move data strips category/heal/boosts fields not needed for the
// damage formula itself.
const dataGen = new Generations(Dex).get(9);

const SLACK_THRESHOLD = 2;
const REST_ID = 'rest';

type MoveCategory = 'attack' | 'boost' | 'heal' | 'utility' | 'excluded';

function categorizeMove(moveName: string): MoveCategory {
  const id = toID(moveName);
  // Rest heals to full but costs ~2 turns of forced sleep -- and unlike
  // Recover/Roost/Slack Off, its dex data has neither a `heal` nor a
  // `status` field to key off at all (confirmed: simulator script logic,
  // not dex data). Modeling the sleep cost honestly needs a genuinely
  // different multi-turn treatment, so it's deliberately excluded here
  // rather than approximated wrong -- see the plan.
  if (id === REST_ID) return 'excluded';
  const data = dataGen.moves.get(id);
  if (!data) return 'utility';
  if (data.category !== 'Status') return 'attack';
  if (data.heal) return 'heal';
  if (selfBoostsFor(moveName)) return 'boost';
  return 'utility';
}

// Hazards I could set on the opponent's side (checked against *their* side
// conditions -- has it already landed) vs. entry hazards already on *my*
// side (checked when evaluating a switch-in's incoming HP loss, see below).
const HAZARD_SIDE_CONDITION: Record<string, string> = {
  stealthrock: 'stealthrock',
  spikes: 'spikes',
  toxicspikes: 'toxicspikes',
  stickyweb: 'stickyweb',
};
const SCREEN_SIDE_CONDITION: Record<string, string> = {
  reflect: 'reflect',
  lightscreen: 'lightscreen',
  auroraveil: 'auroraveil',
};
// Common status-inflicting moves worth gating on "already applied" -- not
// exhaustive (deliberately: a false negative here just costs an occasional
// wasted turn, not a wrong decision, matching the "blanket useful if safe"
// scope agreed for utility moves).
const STATUS_INFLICTING_MOVE = new Set([
  'toxic', 'thunderwave', 'willowisp', 'spore', 'sleeppowder', 'stunspore', 'glare', 'hypnosis', 'darkvoid', 'poisongas',
]);

function isUtilityMoveAlreadyActive(
  moveName: string,
  foeSideConditions: Record<string, { level?: number } | undefined>,
  mySideConditions: Record<string, { level?: number } | undefined>,
  foeStatus: string | undefined
): boolean {
  const id = toID(moveName);
  const hazard = HAZARD_SIDE_CONDITION[id];
  if (hazard) return !!foeSideConditions[hazard];
  const screen = SCREEN_SIDE_CONDITION[id];
  if (screen) return !!mySideConditions[screen];
  if (STATUS_INFLICTING_MOVE.has(id)) return !!foeStatus;
  return false;
}

const rockType = dataGen.types.get('Rock');
const SPIKES_PERCENT_BY_LEVEL = [0, 12.5, 100 / 6, 25]; // 1/8, 1/6, 1/4 max HP

/** Entry-hazard chip estimate for switching `incoming` in, matching
 * @smogon/calc's own getHazards formula: Stealth Rock scales with the
 * incoming Pokemon's type effectiveness against Rock (0x-4x), Spikes is
 * flat per layer but skipped entirely for Flying types / Levitate / Magic
 * Guard, and Heavy-Duty Boots blocks both. */
function estimateEntryHazardPercent(sideConditions: Record<string, { level?: number } | undefined>, incoming: ClientPokemon): number {
  if (incoming.item === 'heavydutyboots') return 0;
  const immune = incoming.ability === 'magicguard' || incoming.ability === 'mountaineer';
  let percent = 0;

  if (sideConditions['stealthrock'] && !immune && rockType) {
    const effectiveness = incoming.types.reduce((mult, t) => mult * (rockType.effectiveness[t] ?? 1), 1);
    percent += effectiveness * 12.5;
  }

  const spikesLevel = sideConditions['spikes']?.level ?? 0;
  if (spikesLevel > 0 && !immune && incoming.ability !== 'levitate' && incoming.item !== 'airballoon' && !incoming.types.includes('Flying')) {
    percent += SPIKES_PERCENT_BY_LEVEL[spikesLevel] ?? 0;
  }

  return percent;
}

/** Move accuracy as a 0-100 number -- true (always hits, e.g. Aerial Ace) and
 * status moves with no accuracy field both normalize to 100. */
function moveAccuracy(moveName: string): number {
  const acc = dataGen.moves.get(toID(moveName))?.accuracy;
  return acc === true || acc === undefined ? 100 : acc;
}

/** A single move's realistic expected damage roll -- the same fallback the
 * dashboard's damage bars already use (mostLikelyPercent when known, else
 * the middle of the min/max range) -- as opposed to maxPercent, which is
 * that move's own ceiling roll, not what it typically does. */
function expectedDamagePercent(m: MoveDamageReport): number {
  return m.mostLikelyPercent ?? (m.minPercent + m.maxPercent) / 2;
}

/** Bench matchups (already fully computed by the analyzer) -> one 'switch'
 * candidate per non-fainted bench Pokemon. Shared between recommendAction
 * (both actives alive, weighed against staying in) and recommendForcedSwitch
 * (your active just fainted, a switch is the only legal choice).
 *
 * `expectedFirstHitPercent` models the turn spent switching: the opponent's
 * move that turn was chosen against whatever you had active *before* the
 * switch (they can't react to it yet), so the incoming Pokemon's first hit
 * is realistically their most threatening move's *expected* damage against
 * your current mon -- not a fresh worst-case pick against the bench mon.
 * Omit it (as recommendForcedSwitch does) when there's no "current mon" to
 * have baited that move in the first place -- a forced switch after a
 * faint isn't exposed to an extra hit that same turn at all, so every turn
 * uses the ongoing worst-case-against-the-new-mon rate from the start. */
export function buildSwitchCandidates(bench: PokemonMatchup[], mySideObj: ClientSide, opponentHpPercent: number, expectedFirstHitPercent?: number): ActionEvaluation[] {
  return bench.map((b) => {
    const theirWorstCaseVsBench = Math.max(0, ...b.opponentMovesVsYou.map((m) => m.maxPercent));
    const incoming = mySideObj.team.find((p) => p.ident === b.yours.ident);
    const hazardChip = incoming ? estimateEntryHazardPercent(mySideObj.sideConditions as any, incoming) : 0;
    const hpAfterHazards = Math.max(0, b.yours.hpPercent - hazardChip);
    const myTurns = availableTurnsAfterSwitch(hpAfterHazards, expectedFirstHitPercent ?? theirWorstCaseVsBench, theirWorstCaseVsBench);
    const bestSwitchInAttack = Math.max(0, ...b.yourMovesVsOpponent.filter((m) => m.confirmed).map((m) => m.minPercent));
    const theirTurns = proposedOpponentTurns(opponentHpPercent, 0, bestSwitchInAttack);
    return {
      kind: 'switch' as const,
      label: `Switch to ${b.yours.species}`,
      myAvailableTurns: myTurns,
      opponentProposedAvailableTurns: theirTurns,
      favorable: isFavorable(myTurns, theirTurns, b.speed.youAreFasterMostLikely),
      persistentBoost: false,
      accuracy: 100, // switching itself always succeeds
    };
  });
}

/** Worst-case damage (max roll, across every candidate attacker scenario and
 * every move name given) into a fixed defender -- same "worst case across
 * scenarios and moves" convention as the rest of this file, just aimed at a
 * hypothetical defender (the tera-flip check's tera'd "you") instead of the
 * analyzer's already-computed opponentMovesVsYou. */
function worstCaseIncomingPercent(attackerScenarios: CandidateScenario[], defender: CalcPokemon, moveNames: string[], field: CalcField): number {
  let worst = 0;
  for (const moveName of moveNames) {
    for (const scenario of attackerScenarios) {
      const result = computeMoveDamage(scenario.calcPokemon, defender, moveName, field);
      if (!result) continue;
      worst = Math.max(worst, result.maxPercent);
    }
  }
  return worst;
}

/** The single best confirmed attacking move's guaranteed floor damage
 * (worst case across the opponent's candidate defender scenarios), plus
 * which move produced it -- same "floor roll, guaranteed at worst"
 * convention as the main attack-candidate loop in recommendAction. */
function bestFloorMove(attacker: CalcPokemon, defenderScenarios: CandidateScenario[], moveNames: string[], field: CalcField): { name: string; percent: number } | undefined {
  let best: { name: string; percent: number } | undefined;
  for (const moveName of moveNames) {
    let min = Infinity;
    for (const scenario of defenderScenarios) {
      const result = computeMoveDamage(attacker, scenario.calcPokemon, moveName, field);
      if (!result) continue;
      min = Math.min(min, result.minPercent);
    }
    if (min !== Infinity && (!best || min > best.percent)) best = { name: moveName, percent: min };
  }
  return best;
}

/** If Tera is still available on `myActive` and nothing else favorable
 * exists (the opponent holds the available-turns advantage no matter what
 * we do this turn), check whether Terastallizing would flip that race:
 * Tera changes both my defensive typing (their worst-case damage into me)
 * and my offensive STAB (my best attack's damage into them). Only returns
 * an action when Tera actually turns the race favorable -- otherwise the
 * caller's least-bad fallback still applies. */
function evaluateTeraFlip(
  matchup: PokemonMatchup,
  myActive: ClientPokemon,
  foeActive: ClientPokemon,
  session: BattleSession,
  mySideObj: ClientSide,
  mySideId: 'p1' | 'p2',
  repo: RandbatsRepository,
  isFaster: boolean
): ActionEvaluation | undefined {
  const teraType = myActive.canTerastallize;
  if (!teraType) return undefined;

  const attackMoveNames = matchup.yourMovesVsOpponent.filter((m) => m.confirmed).map((m) => m.name);
  if (attackMoveNames.length === 0) return undefined;

  const requestInfo = getRequestInfo(session.battle, mySideObj);
  const teraCalc = buildYourCalcPokemon(myActive, requestInfo.get(myActive), teraType);
  const opponentScenarios = buildOpponentScenarios(foeActive, repo, session.damageEvidence.getEvidence(foeActive.speciesForme));
  const field = buildField(session.battle, mySideId);

  const theirWorstCaseVsTeraMe = worstCaseIncomingPercent(opponentScenarios, teraCalc, matchup.opponentMovesVsYou.map((m) => m.name), field);
  const myTurnsIfTera = availableTurns(matchup.yours.hpPercent, theirWorstCaseVsTeraMe);

  const best = bestFloorMove(teraCalc, opponentScenarios, attackMoveNames, field);
  if (!best) return undefined;
  const theirTurnsIfTera = proposedOpponentTurns(matchup.opponent.hpPercent, best.percent, best.percent);

  if (!isFavorable(myTurnsIfTera, theirTurnsIfTera, isFaster)) return undefined;

  return {
    kind: 'tera',
    label: `Terastallize (${teraType}) + ${best.name}`,
    myAvailableTurns: myTurnsIfTera,
    opponentProposedAvailableTurns: theirTurnsIfTera,
    favorable: true,
    persistentBoost: false,
    accuracy: moveAccuracy(best.name),
  };
}

/** Among candidates tied on turns-to-KO, prefer persistent setup, then the
 * more accurate move -- e.g. two attacks that both 2HKO should favor the
 * one less likely to miss. */
export function pickBestByTurnsThenBoost(list: ActionEvaluation[]): ActionEvaluation {
  return list.reduce((best, c) => {
    if (c.opponentProposedAvailableTurns < best.opponentProposedAvailableTurns) return c;
    if (c.opponentProposedAvailableTurns === best.opponentProposedAvailableTurns) {
      if (c.persistentBoost && !best.persistentBoost) return c;
      if (c.persistentBoost === best.persistentBoost && c.accuracy > best.accuracy) return c;
    }
    return best;
  });
}

/**
 * Recommends what to do this turn against the opponent's current active
 * Pokemon (no opponent-switch prediction -- immediate threat only), via a
 * resource comparison ("available turns") rather than a weighted score. See
 * /root/.claude/plans/robust-popping-lemur.md for the full design.
 *
 * Deliberately compute-only: nothing here sends a /choose to the server.
 */
export function recommendAction(report: AnalysisReport, session: BattleSession, repo: RandbatsRepository): RecommendedAction | undefined {
  if (report.waiting || !report.active) return undefined;
  const matchup = report.active;
  if (!session.mySide || (session.mySide !== 'p1' && session.mySide !== 'p2')) return undefined;
  const mySideId: 'p1' | 'p2' = session.mySide;
  const mySideObj = mySideId === 'p1' ? session.battle.p1 : session.battle.p2;
  const foeSideObj = mySideId === 'p1' ? session.battle.p2 : session.battle.p1;
  const myActive = mySideObj.active[0];
  const foeActive = foeSideObj.active[0];
  if (!myActive || !foeActive) return undefined;

  const theirWorstCaseVsMe = Math.max(0, ...matchup.opponentMovesVsYou.map((m) => m.maxPercent));
  const myCurrentAvailableTurns = availableTurns(matchup.yours.hpPercent, theirWorstCaseVsMe);
  // For switch candidates below: the move they're expected to open a switch
  // with -- see buildSwitchCandidates' doc comment.
  const expectedFirstHitVsMe = Math.max(0, ...matchup.opponentMovesVsYou.map(expectedDamagePercent));
  // "Most likely" speed, not worst/best case -- a single deterministic
  // recommendation needs one answer, and most-likely is the pragmatic
  // choice among the three the analyzer already computes.
  const isFaster = matchup.speed.youAreFasterMostLikely;
  // Best unboosted attack floor-roll damage -- reused as the "future rate"
  // for heal/utility lines (neither changes it) without needing to touch
  // the calc at all, since it's already sitting in yourMovesVsOpponent.
  const currentBestAttackPercent = Math.max(0, ...matchup.yourMovesVsOpponent.map((m) => m.minPercent));

  const candidates: ActionEvaluation[] = [];

  // --- Attack: already fully computed by the analyzer, one candidate per
  // confirmed damaging move, no reconstruction needed. ---
  for (const move of matchup.yourMovesVsOpponent) {
    if (!move.confirmed) continue;
    const directDamage = move.minPercent; // floor roll, matches the "guaranteed at worst" principle agreed in design
    const theirTurns = proposedOpponentTurns(matchup.opponent.hpPercent, directDamage, directDamage);
    candidates.push({
      kind: 'attack',
      label: move.name,
      myAvailableTurns: myCurrentAvailableTurns,
      opponentProposedAvailableTurns: theirTurns,
      favorable: isFavorable(myCurrentAvailableTurns, theirTurns, isFaster),
      persistentBoost: false,
      accuracy: moveAccuracy(move.name),
    });
  }

  // --- Boost / heal / utility: these are Status-category moves, invisible
  // to yourMovesVsOpponent (computeMoveDamage filters Status out), so they
  // need the live move list directly. ---
  const nonAttackMoves = myActive.moveSlots.map((m) => ({ name: m.name, category: categorizeMove(m.name) })).filter((m) => m.category !== 'attack' && m.category !== 'excluded');

  let boostReconstruction: { yourCalc: ReturnType<typeof buildYourCalcPokemon>; opponentScenarios: ReturnType<typeof buildOpponentScenarios>; field: ReturnType<typeof buildField> } | undefined;
  const attackMoveNames = matchup.yourMovesVsOpponent.filter((m) => m.confirmed).map((m) => m.name);

  for (const move of nonAttackMoves) {
    if (move.category === 'boost') {
      if (myCurrentAvailableTurns < 1) continue; // can't survive the unprotected setup turn
      const delta = selfBoostsFor(move.name);
      if (!delta) continue;
      if (!boostReconstruction) {
        const requestInfo = getRequestInfo(session.battle, mySideObj);
        boostReconstruction = {
          yourCalc: buildYourCalcPokemon(myActive, requestInfo.get(myActive)),
          opponentScenarios: buildOpponentScenarios(foeActive, repo, session.damageEvidence.getEvidence(foeActive.speciesForme)),
          field: buildField(session.battle, mySideId),
        };
      }
      const boostedRate = bestAttackDamagePercent(boostReconstruction.yourCalc, boostReconstruction.opponentScenarios, attackMoveNames, boostReconstruction.field, delta);
      const theirTurns = proposedOpponentTurns(matchup.opponent.hpPercent, 0, boostedRate);
      candidates.push({
        kind: 'boost',
        label: move.name,
        myAvailableTurns: myCurrentAvailableTurns,
        opponentProposedAvailableTurns: theirTurns,
        favorable: isFavorable(myCurrentAvailableTurns, theirTurns, isFaster),
        persistentBoost: true,
        accuracy: moveAccuracy(move.name),
      });
    } else if (move.category === 'heal') {
      const healFraction = dataGen.moves.get(toID(move.name))?.heal;
      if (!healFraction) continue;
      const healPercent = (healFraction[0] / healFraction[1]) * 100;
      const myTurnsAfterHeal = availableTurns(Math.min(100, matchup.yours.hpPercent + healPercent), theirWorstCaseVsMe);
      const theirTurns = proposedOpponentTurns(matchup.opponent.hpPercent, 0, currentBestAttackPercent);
      candidates.push({
        kind: 'heal',
        label: move.name,
        myAvailableTurns: myTurnsAfterHeal,
        opponentProposedAvailableTurns: theirTurns,
        favorable: isFavorable(myTurnsAfterHeal, theirTurns, isFaster),
        persistentBoost: false,
        accuracy: moveAccuracy(move.name),
      });
    } else {
      // utility -- gated by slack, and by whether its effect is already active
      if (myCurrentAvailableTurns <= SLACK_THRESHOLD) continue;
      if (isUtilityMoveAlreadyActive(move.name, foeSideObj.sideConditions as any, mySideObj.sideConditions as any, matchup.opponent.status)) continue;
      const theirTurns = proposedOpponentTurns(matchup.opponent.hpPercent, 0, currentBestAttackPercent);
      candidates.push({
        kind: 'utility',
        label: move.name,
        myAvailableTurns: myCurrentAvailableTurns,
        opponentProposedAvailableTurns: theirTurns,
        favorable: true, // eligibility is the gate, not the race
        persistentBoost: false,
        accuracy: moveAccuracy(move.name),
      });
    }
  }

  // --- Switch: bench matchups are already fully computed by the analyzer. ---
  candidates.push(...buildSwitchCandidates(report.bench, mySideObj, matchup.opponent.hpPercent, expectedFirstHitVsMe));

  if (candidates.length === 0) return undefined;

  // --- Decision order: utility (if eligible) > best favorable stay-and-act
  // > best favorable switch > least-bad fallback. ---
  const eligibleUtility = candidates.find((c) => c.kind === 'utility');
  if (eligibleUtility) {
    return { action: eligibleUtility, verdict: 'favorable', alternatives: candidates.filter((c) => c !== eligibleUtility) };
  }

  const stayActions = candidates.filter((c) => c.kind === 'attack' || c.kind === 'boost' || c.kind === 'heal');
  const favorableStay = stayActions.filter((c) => c.favorable);
  if (favorableStay.length > 0) {
    const winner = pickBestByTurnsThenBoost(favorableStay);
    return { action: winner, verdict: 'favorable', alternatives: candidates.filter((c) => c !== winner) };
  }

  const switchActions = candidates.filter((c) => c.kind === 'switch');
  const favorableSwitch = switchActions.filter((c) => c.favorable);
  if (favorableSwitch.length > 0) {
    const winner = pickBestByTurnsThenBoost(favorableSwitch);
    return { action: winner, verdict: 'favorable', alternatives: candidates.filter((c) => c !== winner) };
  }

  // --- Nothing favorable found -- the opponent holds the available-turns
  // advantage no matter what we do. Last check before giving up: would
  // Terastallizing flip that race? Only taken if it actually does. ---
  const teraFlip = evaluateTeraFlip(matchup, myActive, foeActive, session, mySideObj, mySideId, repo, isFaster);
  if (teraFlip) {
    return { action: teraFlip, verdict: 'favorable', alternatives: candidates };
  }

  const leastBad = candidates.reduce((best, c) => ((c.myAvailableTurns - c.opponentProposedAvailableTurns) > (best.myAvailableTurns - best.opponentProposedAvailableTurns) ? c : best));
  return { action: leastBad, verdict: 'losing', alternatives: candidates.filter((c) => c !== leastBad) };
}

/**
 * Picks a switch when your active Pokemon has just fainted. This is a
 * distinct entry point from recommendAction because analyzeBattle requires
 * both sides to have a living active Pokemon before it will produce a
 * report at all (see analyzeBattle's "waiting" gate) -- so there's no
 * AnalysisReport to hand to recommendAction here. Instead this builds the
 * same bench-vs-opponent matchups directly and reuses the switch-scoring
 * logic (buildSwitchCandidates) that recommendAction already relies on.
 */
export function recommendForcedSwitch(session: BattleSession, repo: RandbatsRepository): RecommendedAction | undefined {
  if (!session.mySide || (session.mySide !== 'p1' && session.mySide !== 'p2')) return undefined;
  const mySideId: 'p1' | 'p2' = session.mySide;
  const mySideObj = mySideId === 'p1' ? session.battle.p1 : session.battle.p2;
  const foeSideObj = mySideId === 'p1' ? session.battle.p2 : session.battle.p1;
  const foeActive = foeSideObj.active[0];
  if (!foeActive || foeActive.fainted) return undefined;

  const requestInfo = getRequestInfo(session.battle, mySideObj);
  const bench = mySideObj.team
    .filter((p) => !p.fainted)
    .map((p) => buildMatchup(p, foeActive, session, mySideId, repo, requestInfo, false, true));
  if (bench.length === 0) return undefined;

  const switchCandidates = buildSwitchCandidates(bench, mySideObj, bench[0].opponent.hpPercent);
  if (switchCandidates.length === 0) return undefined;

  const favorable = switchCandidates.filter((c) => c.favorable);
  if (favorable.length > 0) {
    const winner = pickBestByTurnsThenBoost(favorable);
    return { action: winner, verdict: 'favorable', alternatives: switchCandidates.filter((c) => c !== winner) };
  }

  const leastBad = switchCandidates.reduce((best, c) => ((c.myAvailableTurns - c.opponentProposedAvailableTurns) > (best.myAvailableTurns - best.opponentProposedAvailableTurns) ? c : best));
  return { action: leastBad, verdict: 'losing', alternatives: switchCandidates.filter((c) => c !== leastBad) };
}
