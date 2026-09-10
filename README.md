# Titan Fantasy Football

Start/sit calls, waiver upgrades, exposure and bye weeks across every Sleeper
league you play in, ordered by your own rankings.

Link a Sleeper username (no password needed). Titan finds your leagues and
their lineup formats, then compares the lineups you have set with the ones
your rankings would start.

It grew out of a personal tool, the Sleeper Command Center, and uses the same
start/sit rules, made to work for any Sleeper account.

## How it works

1. **Link**: enter a Sleeper username. Sleeper's public API returns the user ID,
   and every refresh re-reads the user's leagues, including each league's lineup
   slots, team count and scoring. A commissioner's format change is picked up
   automatically.
2. **Import rankings**: a CSV file or a paste. Two layouts are read:
   one row per player (`Player, Pos, Team, Rank[, Opp, Implied, Tier]`), or
   side-by-side position tables like Late-Round's export
   (`QB Rank, QB Player, …, FLEX Rank, FLEX Player, …`).
3. **Follow the calls**: every lineup slot gets a verdict (OK, SWAP OUT,
   DO NOT START, UNRANKED, LOCKED), with the exact swaps to make, ranked free
   agents nobody in the league has, and injured starters.

Sleeper is read-only. Titan can't set lineups, claim waivers or trade.

## Screens

| Screen | What it shows |
|---|---|
| Lineups | Each league's lineup as set in Sleeper, with a verdict on every slot, the changes to make, wire upgrades and injuries |
| Rosters | Every rostered player per league, with rank, tier, opponent and bye |
| Exposure | Players on two or more of your teams |
| Byes | How many of your players are off each week, per league |
| Scorecard | For any week: what you scored, what your rankings would have scored, and the perfect-hindsight score |
| Rankings | Import and manage weekly rankings |
| Settings | Linked account, which leagues Titan manages, refresh log |

## Rules worth knowing

- **Rankings are the only order.** Unranked players sit last. Out, Doubtful and
  IR players sit below even unranked ones.
- **Locks follow Sleeper.** Each player locks at his own game's kickoff. A
  locked starter keeps his slot, and a locked bench player can't come in.
- **Supported slots:** QB, RB, WR, TE, FLEX, W/R flex, W/T flex, SUPER_FLEX, K,
  DEF, plus basic IDP slots. Best-ball leagues start switched off, because
  Sleeper sets their lineups itself.
- **Byes come from Sleeper's schedule**, so they stay right every season.

## Where data lives (today)

Everything is kept in the browser on the user's own device (`localStorage`):
the linked username, league switches, rankings and the last refresh. The
device talks to `api.sleeper.app` directly. There's no Titan server. See
`privacy.html`.

## Files

```
index.html             Page shell
styles.css             All styling
engine.js              Start/sit, wire, exposure, bye and scorecard rules (pure; no page or network code)
sleeper.js             Sleeper API calls, league discovery and browser storage
app.js                 Screens and interactions
sw.js                  Service worker: offline shell, installable app
manifest.webmanifest   App name and icons for installing
icon*.svg / icon*.png  App icons (the PNGs are rendered from the SVGs)
privacy.html           Privacy policy
```

No build step and no dependencies. It runs on any static host.

## Roadmap

1. **Done: public web app.** Any Sleeper user, rankings private on the device.
2. **Next: sync across your own devices.** Google sign-in with Firebase
   (Authentication + Firestore). Each user's rankings and league switches are
   stored under their own account, readable only by them. Hosting moves to
   Firebase Hosting, which also provides the root domain Google Play needs.
3. **Then: Google Play.** Package the same web app as a Trusted Web Activity
   (Bubblewrap), with a Digital Asset Links file at
   `/.well-known/assetlinks.json` on the hosting domain. Needs a Google Play
   developer account, a privacy policy, the data-safety form, and the closed
   test Google requires of new personal developer accounts.
