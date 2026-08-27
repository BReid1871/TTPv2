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
}

export interface YourPokemonInfo {
  ident: string;
  species: string;
  hpPercent: number;
  status?: string;
  fainted: boolean;
  isActive: boolean;
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
}
