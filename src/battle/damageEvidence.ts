import type { Battle, Pokemon as ClientPokemon, Side as ClientSide } from '@pkmn/client';
import { toID, type SideID } from '@pkmn/data';
import { getRequestStats } from './requestStats.js';
import type { PlainFieldSnapshot, PlainSideConditions } from '../calc/damage.js';

export type SideConditionsSnapshot = PlainSideConditions;
export type FieldSnapshot = PlainFieldSnapshot;

export interface KnownPokemonSnapshot {
  speciesForme: string;
  level: number;
  ability: string;
  item: string;
  status?: string;
  teraType?: string;
  isTerastallized: boolean;
  rawStats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  boosts: Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  currentHpFraction: number;
}

export type StatBoosts = Partial<Record<'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;

/** A single clean, unambiguous hit between a known (yours, exact stats) and
 * an unknown (opponent) Pokemon, with everything needed to recompute what
 * damage each of the opponent's item candidates would have produced. Only
 * created for hits we can attribute with confidence -- see observeLine(). */
export interface DamageEvidence {
  moveId: string;
  damagePercent: number;
  /** 'dealt' = the opponent Pokemon was the attacker (reveals their offense);
   * 'taken' = the opponent Pokemon was the defender (reveals their defense). */
  direction: 'dealt' | 'taken';
  turn: number;
  known: KnownPokemonSnapshot;
  opponentSpeciesForme: string;
  opponentBoosts: StatBoosts;
  opponentStatus?: string;
  opponentTeraType?: string;
  opponentIsTerastallized: boolean;
  field: FieldSnapshot;
}

interface PendingMove {
  attackerIdent: string;
  attackerSpeciesId: string;
  attackerSideId: SideID;
  targetIdent: string;
  targetSpeciesId: string;
  moveId: string;
  targetHpFractionBefore: number;
  hitCount: number;
  spoiled: boolean;
}

function lookupPokemon(battle: Battle, ident: string): ClientPokemon | undefined {
  if (!ident) return undefined;
  const sideId = ident.slice(0, 2);
  const side = sideId === 'p1' ? battle.p1 : sideId === 'p2' ? battle.p2 : undefined;
  if (!side) return undefined;
  return side.team.find((p) => p.ident === ident) ?? side.active.find((p): p is ClientPokemon => !!p && p.ident === ident);
}

function pickBoosts(p: ClientPokemon): StatBoosts {
  const b = p.boosts;
  return { atk: b.atk ?? 0, def: b.def ?? 0, spa: b.spa ?? 0, spd: b.spd ?? 0, spe: b.spe ?? 0 };
}

function snapshotSideConditions(side: ClientSide): SideConditionsSnapshot {
  const c = side.sideConditions;
  return {
    spikes: c['spikes']?.level ?? 0,
    isSR: !!c['stealthrock'],
    isReflect: !!c['reflect'],
    isLightScreen: !!c['lightscreen'],
    isAuroraVeil: !!c['auroraveil'],
    isTailwind: !!c['tailwind'],
  };
}

function snapshotField(battle: Battle, mySideId: SideID): FieldSnapshot {
  const field = battle.field;
  const mySide = mySideId === 'p1' ? battle.p1 : battle.p2;
  const opponentSide = mySideId === 'p1' ? battle.p2 : battle.p1;
  return {
    weather: field.weather || undefined,
    terrain: field.terrain || undefined,
    isGravity: field.hasPseudoWeather('gravity' as any),
    mySideConditions: snapshotSideConditions(mySide),
    opponentSideConditions: snapshotSideConditions(opponentSide),
  };
}

/**
 * Watches the raw protocol stream for clean, single-hit damage exchanges
 * between a known Pokemon (yours) and an unknown one (the opponent's), and
 * records them as DamageEvidence keyed by opponent species -- later used to
 * eliminate item candidates that couldn't have produced the observed %.
 *
 * Deliberately conservative: anything ambiguous (a crit, a miss, a multi-hit
 * move, a Substitute absorbing the hit, secondary/residual damage) discards
 * the in-progress observation instead of guessing. Missing evidence just
 * means less narrowing, which is always safer than wrong narrowing.
 */
export class DamageEvidenceTracker {
  private readonly evidenceBySpecies = new Map<string, DamageEvidence[]>();
  private pending?: PendingMove;

  observeLine(line: string, battle: Battle, mySideId: SideID | undefined): void {
    if (!line.startsWith('|')) return;
    const parts = line.slice(1).split('|');
    const type = parts[0];

    switch (type) {
      case 'move': {
        const attackerIdent = parts[1];
        const moveName = parts[2];
        const targetIdent = parts[3];
        this.pending = undefined;
        if (!attackerIdent || !moveName || !targetIdent) return;
        const attackerSideId = attackerIdent.slice(0, 2);
        const targetSideId = targetIdent.slice(0, 2);
        if ((attackerSideId !== 'p1' && attackerSideId !== 'p2') || attackerSideId === targetSideId) return;
        const attacker = lookupPokemon(battle, attackerIdent);
        const target = lookupPokemon(battle, targetIdent);
        if (!attacker || !target || !target.maxhp) return;
        this.pending = {
          attackerIdent,
          attackerSpeciesId: toID(attacker.speciesForme),
          attackerSideId: attackerSideId as SideID,
          targetIdent,
          targetSpeciesId: toID(target.speciesForme),
          moveId: toID(moveName),
          targetHpFractionBefore: target.hp / target.maxhp,
          hitCount: 0,
          spoiled: false,
        };
        return;
      }
      case 'switch':
      case 'drag':
      case 'turn':
      case 'faint':
      case '-miss':
      case '-fail':
      case '-immune':
        this.pending = undefined;
        return;
      case '-crit':
        if (this.pending && parts[1] === this.pending.targetIdent) this.pending.spoiled = true;
        return;
      case '-activate':
        if (this.pending && parts[1] === this.pending.targetIdent && (parts[2] ?? '').toLowerCase().includes('substitute')) {
          this.pending.spoiled = true;
        }
        return;
      case '-damage': {
        const pending = this.pending;
        if (!pending || parts[1] !== pending.targetIdent) return;
        const hasFromTag = parts.some((p) => p.startsWith('[from]'));
        if (hasFromTag) return; // residual/secondary damage, not the move's direct hit
        pending.hitCount++;
        if (pending.hitCount > 1) {
          // multi-hit move: total damage across hits isn't a simple per-hit range
          pending.spoiled = true;
          return;
        }
        if (pending.spoiled) return;
        const target = lookupPokemon(battle, pending.targetIdent);
        if (!target || !target.maxhp || !mySideId) return;
        const hpFractionAfter = target.hp / target.maxhp;
        const damagePercent = (pending.targetHpFractionBefore - hpFractionAfter) * 100;
        if (damagePercent <= 0) return;
        this.record(battle, mySideId, pending, damagePercent);
        return;
      }
      default:
        return;
    }
  }

  private record(battle: Battle, mySideId: SideID, pending: PendingMove, damagePercent: number): void {
    const opponentSideId: SideID = mySideId === 'p1' ? 'p2' : 'p1';
    let direction: 'dealt' | 'taken';
    let opponentSpeciesId: string;
    let opponentIdent: string;
    let myIdent: string;
    if (pending.attackerSideId === opponentSideId) {
      direction = 'dealt';
      opponentSpeciesId = pending.attackerSpeciesId;
      opponentIdent = pending.attackerIdent;
      myIdent = pending.targetIdent;
    } else if (pending.attackerSideId === mySideId) {
      direction = 'taken';
      opponentSpeciesId = pending.targetSpeciesId;
      opponentIdent = pending.targetIdent;
      myIdent = pending.attackerIdent;
    } else {
      return;
    }

    const myPokemon = lookupPokemon(battle, myIdent);
    const opponentPokemon = lookupPokemon(battle, opponentIdent);
    if (!myPokemon || !opponentPokemon || !myPokemon.maxhp) return;

    const mySideObj = mySideId === 'p1' ? battle.p1 : battle.p2;
    const stats = getRequestStats(battle, mySideObj).get(myPokemon);
    if (!stats) return; // don't have exact stats for our own mon yet -- skip rather than guess

    const record: DamageEvidence = {
      moveId: pending.moveId,
      damagePercent,
      direction,
      turn: battle.turn,
      known: {
        speciesForme: myPokemon.speciesForme,
        level: myPokemon.level,
        ability: myPokemon.ability,
        item: myPokemon.item,
        status: myPokemon.status,
        teraType: myPokemon.terastallized,
        isTerastallized: !!myPokemon.terastallized,
        rawStats: { hp: myPokemon.maxhp, ...stats },
        boosts: pickBoosts(myPokemon),
        currentHpFraction: myPokemon.hp / myPokemon.maxhp,
      },
      opponentSpeciesForme: opponentPokemon.speciesForme,
      opponentBoosts: pickBoosts(opponentPokemon),
      opponentStatus: opponentPokemon.status,
      opponentTeraType: opponentPokemon.terastallized,
      opponentIsTerastallized: !!opponentPokemon.terastallized,
      field: snapshotField(battle, mySideId),
    };

    const list = this.evidenceBySpecies.get(opponentSpeciesId) ?? [];
    list.push(record);
    this.evidenceBySpecies.set(opponentSpeciesId, list);
  }

  getEvidence(speciesForme: string): DamageEvidence[] {
    return this.evidenceBySpecies.get(toID(speciesForme)) ?? [];
  }
}
