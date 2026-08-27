export const config = {
  username: requireEnv('SHOWDOWN_USERNAME'),
  password: requireEnv('SHOWDOWN_PASSWORD'),
  server: process.env.SHOWDOWN_SERVER ?? 'sim3.psim.us',
  loginServer: process.env.SHOWDOWN_LOGIN_SERVER ?? 'https://play.pokemonshowdown.com',
  port: Number(process.env.PORT ?? 3000),
  randbatsFormat: process.env.RANDBATS_FORMAT ?? 'gen9randombattle',
  randbatsRefreshMs: Number(process.env.RANDBATS_REFRESH_MS ?? 60 * 60 * 1000),
};

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
