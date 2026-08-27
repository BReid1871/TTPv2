import { toID } from '@pkmn/data';
import { config } from '../config.js';

export interface RandbatsRole {
  abilities: string[];
  items: string[];
  teraTypes: string[];
  moves: string[];
  evs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
  ivs?: Partial<Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>>;
}

export interface RandbatsSpecies {
  level: number;
  abilities: string[];
  items: string[];
  moves?: string[];
  roles: Record<string, RandbatsRole>;
}

export type RandbatsData = Record<string, RandbatsSpecies>;

const DATA_URL = `https://pkmn.github.io/randbats/data/${config.randbatsFormat}.json`;

/**
 * Loads and periodically refreshes the community-maintained "randbats" data
 * set (derived by sampling real games from Showdown's random-battle team
 * generator). This is the ground truth for "what could this Pokemon's kit
 * be" in Gen 9 Random Battle: species -> named roles -> candidate abilities/
 * items/tera types/moves for that role.
 */
export class RandbatsRepository {
  private data: RandbatsData = {};
  private byId = new Map<string, RandbatsSpecies>();
  private lastLoaded = 0;
  private timer?: NodeJS.Timeout;

  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      this.refresh().catch((err) => console.error('[randbats] refresh failed', err));
    }, config.randbatsRefreshMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get loadedAt(): number {
    return this.lastLoaded;
  }

  get speciesCount(): number {
    return this.byId.size;
  }

  /** Look up a species entry by any reasonably-spelled name/forme string. */
  lookup(speciesName: string): RandbatsSpecies | undefined {
    return this.byId.get(toID(speciesName));
  }

  private async refresh(): Promise<void> {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`randbats fetch failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as RandbatsData;
    this.data = data;
    this.byId = new Map(Object.entries(data).map(([name, entry]) => [toID(name), entry]));
    this.lastLoaded = Date.now();
    console.log(`[randbats] loaded ${this.byId.size} species from ${DATA_URL}`);
  }
}
