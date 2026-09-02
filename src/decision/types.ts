export type ActionKind = 'attack' | 'boost' | 'heal' | 'utility' | 'switch' | 'tera';

export interface ActionEvaluation {
  kind: ActionKind;
  /** move name, or "Switch to <species>" */
  label: string;
  /** how many more of the opponent's worst-case hits I can take, given this action */
  myAvailableTurns: number;
  /** how many more turns it takes me to finish the opponent off, given this action */
  opponentProposedAvailableTurns: number;
  /** speed-aware: isFaster ? myAvailableTurns <= opponentProposedAvailableTurns : myAvailableTurns < opponentProposedAvailableTurns */
  favorable: boolean;
  /** true for boost-kind actions -- tie-break preference toward setup on an otherwise-equal race */
  persistentBoost: boolean;
  /** kind 'tera' only -- the actual move to send alongside the terastallize
   * flag. label is a display string ("Terastallize (Type) + MoveName") for
   * this kind rather than a plain move name, so execution needs this
   * instead of parsing label. */
  teraMoveName?: string;
  /** move accuracy, 0-100 (100 for always-hit moves and non-move actions like switching) --
   * tie-break toward the more reliable move when two attacks land on the same N-hit-KO */
  accuracy: number;
}

export interface RecommendedAction {
  action: ActionEvaluation;
  /** 'losing' means no favorable option existed anywhere -- this is the least-bad pick, not a confident one */
  verdict: 'favorable' | 'losing';
  alternatives: ActionEvaluation[];
}
