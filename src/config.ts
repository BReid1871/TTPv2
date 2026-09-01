export const config = {
  username: requireEnv('SHOWDOWN_USERNAME'),
  password: requireEnv('SHOWDOWN_PASSWORD'),
  server: process.env.SHOWDOWN_SERVER ?? 'sim3.psim.us',
  loginServer: process.env.SHOWDOWN_LOGIN_SERVER ?? 'https://play.pokemonshowdown.com',
  port: Number(process.env.PORT ?? 3000),
  randbatsFormat: process.env.RANDBATS_FORMAT ?? 'gen9randombattle',
  randbatsRefreshMs: Number(process.env.RANDBATS_REFRESH_MS ?? 60 * 60 * 1000),
  // Where each finished battle's raw protocol log + per-turn recommendation
  // snapshot gets written -- see src/logging/battleLogger.ts. On Railway
  // this needs a Volume mounted at this path or it's wiped on every restart.
  battleLogDir: process.env.BATTLE_LOG_DIR ?? './battle-logs',
  // If set, the /logs* dashboard routes require this exact value as
  // ?token=... or an `Authorization: Bearer ...` header -- unset means
  // those routes are open to anyone who can reach the public URL.
  logsAccessToken: process.env.LOGS_ACCESS_TOKEN,
  // How many Random Battles AutoPlayer will play at once. Defaults to 1
  // (the original, single-battle-at-a-time behavior). Showdown treats a
  // second /search for a format you're already searching as *cancelling*
  // the first rather than queueing a second ticket, so this doesn't burst
  // N searches at once -- it ramps up to N concurrent battles by
  // re-searching immediately after each one lands, capped at this number.
  maxConcurrentBattles: Math.max(1, Number(process.env.MAX_CONCURRENT_BATTLES ?? 1)),
  // ANALYSIS_MODE=1 -> analysis mode (watch-only, never acts, current/legacy
  // behavior). ANALYSIS_MODE=0 -> automated mode (queues for and plays its
  // own Random Battles using the same recommendation engine). Defaults to
  // analysis mode (the safe, non-acting choice) if unset or unrecognized.
  analysisMode: process.env.ANALYSIS_MODE !== '0',
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
