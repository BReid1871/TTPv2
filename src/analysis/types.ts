export interface WeightedOption {
  name: string;
  probability: number;
}

export interface MoveDamageReport {
  name: string;
  minPercent: number;
  maxPercent: number;
  mostLikelyPercent?: number;
  koChance?: string;
  /** true if we're certain the attacker actually has this move */
  confirmed: boolean;
  /** only set for unconfirmed (candidate) moves */
  probability?: number;
  /** only set for a two-turn charge move (Solar Beam, Fly, ...): whether
   * using it right now would be instant (weather match / Power Herb) or
   * take the full two turns */
  chargeNotice?: string;
}

export interface SpeedReport {
  yourSpeed: number;
  opponentSpeedRange: [number, number];
  opponentSpeedMostLikely: number;
  youAreFasterWorstCase: boolean;
  youAreFasterBestCase: boolean;
  youAreFasterMostLikely: boolean;
  trickRoomActive: boolean;
}

export interface OpponentSetInfo {
  ident: string;
  species: string;
  level: number;
  hpPercent: number;
  status?: string;
  fainted: boolean;
  isActive: boolean;
  dataFound: boolean;
  candidateRoles: string[];
  ability: { known?: string; possible: WeightedOption[] };
  item: { known?: string; possible: WeightedOption[] };
  teraType: { known?: string; possible: WeightedOption[] };
  revealedMoves: string[];
  possibleRemainingMoves: WeightedOption[];
  /** set while this Pokemon is mid-charge on a semi-invulnerability move
   * (Fly, Dig, Dive, Bounce, Phantom Force, Shadow Force) -- the move name
   * as sent by the server, e.g. 'Fly' */
  chargingMove?: string;
}

export interface YourPokemonInfo {
  ident: string;
  species: string;
  hpPercent: number;
  status?: string;
  fainted: boolean;
  isActive: boolean;
  chargingMove?: string;
}

export interface PokemonMatchup {
  yours: YourPokemonInfo;
  opponent: OpponentSetInfo;
  yourMovesVsOpponent: MoveDamageReport[];
  opponentMovesVsYou: MoveDamageReport[];
  speed: SpeedReport;
}

export interface AnalysisReport {
  roomid: string;
  turn: number;
  generatedAt: number;
  format: string;
  waiting: boolean;
  waitingReason?: string;
  active?: PokemonMatchup;
  bench: PokemonMatchup[];
  opponentRevealedBench: OpponentSetInfo[];
  /** computed separately (see src/decision/recommendAction.ts) and attached
   * by the caller -- compute-only, nothing sends this to the server */
  recommendedAction?: import('../decision/types.js').RecommendedAction;
}
