export type ActionKind = 'attack' | 'boost' | 'heal' | 'utility' | 'switch';

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
}

export interface RecommendedAction {
  action: ActionEvaluation;
  /** 'losing' means no favorable option existed anywhere -- this is the least-bad pick, not a confident one */
  verdict: 'favorable' | 'losing';
  alternatives: ActionEvaluation[];
}
