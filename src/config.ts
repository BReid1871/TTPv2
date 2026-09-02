export type Mode = 'analysis' | 'automated' | 'auto-accept';

// MODE=analysis -> watch-only, never acts (the safe default).
// MODE=automated -> queues for and plays its own Random Battles.
// MODE=auto-accept -> never searches; accepts any incoming challenge and
// plays it out with the same recommendation engine as automated mode.
// Falls back to the older boolean ANALYSIS_MODE (1/unset = analysis, 0 =
// automated) when MODE isn't set, so existing deployments keep working.
function resolveMode(): Mode {
  const raw = process.env.MODE?.trim().toLowerCase();
  if (raw === 'analysis' || raw === 'automated' || raw === 'auto-accept') return raw;
  return process.env.ANALYSIS_MODE === '0' ? 'automated' : 'analysis';
}

export const config = {
  username: requireEnv('SHOWDOWN_USERNAME'),
  password: requireEnv('SHOWDOWN_PASSWORD'),
  server: process.env.SHOWDOWN_SERVER ?? 'sim3.psim.us',
  loginServer: process.env.SHOWDOWN_LOGIN_SERVER ?? 'https://play.pokemonshowdown.com',
  port: Number(process.env.PORT ?? 3000),
  randbatsFormat: process.env.RANDBATS_FORMAT ?? 'gen9randombattle',
  randbatsRefreshMs: Number(process.env.RANDBATS_REFRESH_MS ?? 60 * 60 * 1000),
  // How many Random Battles AutoPlayer will play at once. Defaults to 1
  // (the original, single-battle-at-a-time behavior). In automated mode,
  // Showdown treats a second /search for a format you're already searching
  // as *cancelling* the first rather than queueing a second ticket, so this
  // doesn't burst N searches at once -- it ramps up to N concurrent battles
  // by re-searching immediately after each one lands, capped at this number.
  // In auto-accept mode, this instead caps how many incoming challenges get
  // accepted at once -- one arriving past the cap is held and accepted once
  // a slot frees up (see AutoPlayer.drainPendingChallenges).
  maxConcurrentBattles: Math.max(1, Number(process.env.MAX_CONCURRENT_BATTLES ?? 1)),
  // Where each finished battle's raw protocol log + per-turn report
  // snapshot gets written -- see src/logging/battleLogger.ts. On Railway
  // this needs a Volume mounted at this path or it's wiped on every restart.
  battleLogDir: process.env.BATTLE_LOG_DIR ?? './battle-logs',
  // If set, the /logs* dashboard routes (including /replay.html) require
  // this exact value as ?token=... or an `Authorization: Bearer ...` header
  // -- unset means those routes are open to anyone who can reach the public URL.
  logsAccessToken: process.env.LOGS_ACCESS_TOKEN,
  mode: resolveMode(),
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
