# TTP3 — Pokemon Showdown Random Battle Analyzer

Follows along your Gen 9 Random Battle games on Pokemon Showdown and shows a
live dashboard with:

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

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `SHOWDOWN_USERNAME` | yes | The Showdown account to log in as (the one you play Random Battle on). |
| `SHOWDOWN_PASSWORD` | yes | That account's password. |
| `PORT` | no | Port for the dashboard web server (default `3000`; Railway sets this for you). |
| `SHOWDOWN_SERVER` | no | Websocket host to connect to (default `sim3.psim.us`). |
| `RANDBATS_FORMAT` | no | Which random-battle format's set data to load (default `gen9randombattle`). |
| `RANDBATS_REFRESH_MS` | no | How often to refresh the randbats set data (default 1 hour). |

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
