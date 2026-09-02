# TTP3 — Pokemon Showdown Random Battle Analyzer

Follows along your Gen 9 Random Battle games on Pokemon Showdown and shows a
live dashboard with:

Runs in one of two modes, set via `ANALYSIS_MODE`:

- **Analysis mode** (`ANALYSIS_MODE=1`, or unset — the default): watch-only.
  It spectates whatever battle you start or join and shows recommendations
  on the dashboard, but never sends a battle command itself.
- **Automated mode** (`ANALYSIS_MODE=0`): queues for its own Random Battle,
  plays it out move-by-move using the same recommendation engine, then
  queues for the next one when it ends — leave it running and it'll keep
  playing on its own. It plays *every* battle its account ends up in, so
  don't also play manually on that account while this mode is running; use
  analysis mode for that instead. Set `MAX_CONCURRENT_BATTLES` (default `1`)
  to play more than one battle at once — it ramps up to that many by
  re-queueing immediately each time a match lands, since Showdown only
  allows one outstanding search at a time. Note this makes the account look
  more obviously bot-like (near-continuous play across several rooms at
  once), which is the kind of pattern that gets a bot account reported —
  Showdown has no hard rule against automation, but staff permaban bot
  accounts on a case-by-case basis once they're noticed.

- Damage % (min–max) for every one of your moves against the opponent's active Pokemon
- Damage % (min–max) for every move the opponent's Pokemon could plausibly know against you
- Who's faster, right now, including best/worst/most-likely cases while the opponent's set is still uncertain
- The same damage + speed breakdown for your benched Pokemon vs. the opponent's active
- A narrowed-down read on the opponent's set (candidate Random Battle "roles", possible ability/item/Tera type with probabilities, and likely remaining moves) that gets more precise every time they reveal something new

It works by logging into Showdown with the same account you play on (a second,
concurrent connection — Showdown allows multiple sessions per account), so it
automatically sees whatever battle you start or join and mirrors it as a
spectator. It never sends any battle commands itself.

## How it works

- `src/showdown/` — websocket connection + login handshake, and a watcher
  that follows the account's `|updatesearch|` events to auto-join/leave
  whatever battle room(s) you're playing in.
- `src/battle/` — wraps [`@pkmn/client`](https://github.com/pkmn/ps)'s
  `Battle` to track full battle state from the protocol stream (including
  your own `|request|` data, which gives exact stats/ability/item/moves for
  your whole team).
- `src/randbats/` — loads the community-maintained
  [pkmn/randbats](https://github.com/pkmn/randbats) data set (species →
  role → candidate abilities/items/Tera types/movepool) and narrows it down
  using everything revealed about an opponent's Pokemon so far.
- `src/calc/` — wraps [`@smogon/calc`](https://github.com/smogon/damage-calc)
  for damage %, and a small port of its internal speed formula (boosts,
  Tailwind, weather/terrain abilities, Choice Scarf/Iron Ball, paralysis,
  Protosynthesis/Quark Drive) for speed comparisons.
- `src/analysis/analyzer.ts` — combines all of the above into one
  `AnalysisReport` per battle, evaluating the opponent's damage/speed across
  their most probable candidate sets when a detail isn't confirmed yet.
- `src/web/` — a tiny Express + `ws` server that pushes each new
  `AnalysisReport` to a live browser dashboard (`src/web/public/`).
- `src/logging/battleLogger.ts` — saves every finished battle to disk (raw
  protocol log + the per-turn `AnalysisReport` the dashboard showed live),
  which `/logs` and `/replay.html` (see below) read back to let you rewatch
  a battle turn by turn with the advisor's reasoning attached.

## Battle history & replays

Every finished battle is saved to a folder under `BATTLE_LOG_DIR`
(`./battle-logs` by default): the raw protocol log, a `meta.json` summary,
and a `reports.json` with, for every turn, the exact recommendation +
matchup breakdown the dashboard showed live at the time (including forced
switches after a faint, which run outside the normal analysis pass) *and*
a plain-English play-by-play of what actually happened that turn (moves
used, damage, status, switches, faints, weather/hazard ticks, ...) via
[`@pkmn/view`](https://github.com/pkmn/ps)'s `LogFormatter`.

- `/logs` — battle history: one row per saved battle (opponent, result,
  format, turn count, duration) with links to watch the replay, download a
  zip, or grab the raw files.
- `/replay.html?id=<battle id>` — steps through a saved battle turn by
  turn using the same rendering as the live dashboard: **◀ Prev turn** /
  **Next turn ▶** to move one turn at a time, **▶ Play** to autoplay
  through the whole battle (click again, or **⏸ Pause**, to stop), a
  slider to jump straight to a turn, and left/right arrow keys / spacebar
  as shortcuts. Each turn shows a "What happened" play-by-play followed by
  exactly what the advisor recommended and why, same as it appeared live.

Set `LOGS_ACCESS_TOKEN` if the dashboard is reachable from a public URL
(e.g. deployed on Railway) — without it, `/logs` and `/replay.html` are
open to anyone who can reach that URL.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SHOWDOWN_USERNAME` | yes | The Showdown account to log in as (the one you play Random Battle on). |
| `SHOWDOWN_PASSWORD` | yes | That account's password. |
| `ANALYSIS_MODE` | no | `1` (or unset) = analysis mode, watch-only, never acts (default). `0` = automated mode, plays its own Random Battles back-to-back. See above. |
| `PORT` | no | Port for the dashboard web server (default `3000`; Railway sets this for you). |
| `SHOWDOWN_SERVER` | no | Websocket host to connect to (default `sim3.psim.us`). |
| `RANDBATS_FORMAT` | no | Which random-battle format's set data to load (default `gen9randombattle`). |
| `RANDBATS_REFRESH_MS` | no | How often to refresh the randbats set data (default 1 hour). |
| `MAX_CONCURRENT_BATTLES` | no | Automated mode only: how many battles to play at once (default `1`). |
| `BATTLE_LOG_DIR` | no | Where finished battles are saved for `/logs` and `/replay.html` (default `./battle-logs`). Needs a persistent volume on Railway or it's wiped on every restart. |
| `LOGS_ACCESS_TOKEN` | no | If set, `/logs` and `/replay.html` require this value as `?token=...` or an `Authorization: Bearer ...` header. |

## Running locally

```bash
npm install
npm run dev      # tsx watch, no build step
```

Then open `http://localhost:3000`. Start a Gen 9 Random Battle on Showdown
logged in as the same account and the dashboard will pick it up automatically.

## Deploying on Railway

This repo includes a `railway.json`. With `SHOWDOWN_USERNAME` and
`SHOWDOWN_PASSWORD` set as project variables, Railway's Nixpacks builder will
run `npm install && npm run build` and then `npm start`. Open the deployed
Railway URL to view the dashboard while you play.

## Known limitations

- Only Gen 9 Random Battle (`gen9randombattle`) is analyzed by default; other
  random-battle-family formats can be tried via `RANDBATS_FORMAT` but singles
  is the only supported game type right now (doubles/multi aren't handled).
- Opponent set narrowing is a probability heuristic (uniform over an
  archetype's candidate roles/items/moves), not a simulation of Showdown's
  exact set-generation algorithm — treat percentages as "roughly this
  likely," not exact.
- A handful of conditional ability effects (Unburden after consuming an
  item, Flash Fire after being hit, Slow Start's first-5-turns window, etc.)
  aren't tracked in real time, so they're assumed inactive in damage/speed
  calculations.
