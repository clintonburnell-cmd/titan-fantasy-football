# Titan Fantasy Football Manager

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
2. **Import rankings**: a CSV file or a paste. Three layouts are read:
   one row per player (`Player, Pos, Team, Rank[, Opp, Implied, Tier]`);
   side-by-side position tables like Late-Round's export
   (`QB Rank, QB Player, …, FLEX Rank, FLEX Player, …`); and FantasyPros
   exports (`RK, PLAYER NAME, TEAM, OPP`), one file per position, where the position
   comes from the file name or the user's pick. A file ranking only some positions is
   added to that week and replaces just those positions. For RB/WR/TE, FantasyPros'
   FLEX file gives the overall ranks FLEX slots need.
3. **Follow the calls**: every lineup slot gets a verdict (OK, SWAP OUT,
   DO NOT START, UNRANKED, LOCKED), with the exact swaps to make, ranked free
   agents nobody in the league has, and injured starters.

Sleeper is read-only. Titan can't set lineups, claim waivers or trade.

The header has a Ko-fi tip jar ("Like my work? Consider a tip!"). It shows only on
the website. The Google Play app opens `/?source=play`, and Titan hides the tip jar
for that session, because tips inside a Play app must use Google Play billing.

On iPhone and iPad, Titan runs as a home-screen web app (Safari: Share, then Add to
Home Screen). Visitors in the browser see a one-time tip explaining that. From the
home screen, Google sign-in uses a full-page redirect, because iOS home-screen apps
can't hand a popup back. An App Store version is a later step: Apple needs a native
wrapper built on a Mac, Sign in with Apple alongside Google, and features beyond the
website (such as alerts) to pass review.

## Screens

| Screen | What it shows |
|---|---|
| Lineups | Each league's lineup as set in Sleeper, with a verdict on every slot, the changes to make, wire upgrades and injuries |
| News | News-only X accounts (@UnderdogNFL), each opening on X. X doesn't let apps read posts without a paid plan |
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

## Where data lives

- **On the device** (`localStorage`): the linked Sleeper username, league
  switches, rankings, the last refresh and a trimmed player list. Titan works
  fully on one device without signing in.
- **In the person's own account, if they sign in with Google** (Firebase
  Authentication + Cloud Firestore, `nam5`): `users/{uid}` holds the Sleeper
  link and league switches, and `users/{uid}/ranks/{week}` holds each week's
  rankings. `firestore.rules` lets only that signed-in person read or write
  their own data.
- **Sleeper** is read directly from the device (`api.sleeper.app`). Titan has
  no server of its own.

See `privacy.html`.

## Sync

`sync.js` (an ES module) signs in with Google and keeps the device and the
account level. The rules for which copy wins live in `syncplan.js`, which is
pure and tested: the newer copy wins, compared by the timestamp stamped on
every save, week by week for rankings. Changes from another device apply
live. Signing out stops syncing on that device. **Delete my Titan account**
in Settings removes the synced data and the sign-in.

Sync is optional by design. If Firebase can't load (offline, blocked, or the
page opened from a file), the app runs on the device alone. Sign-in works on
the Firebase Hosting domains; the GitHub Pages address forwards to
`titan-fantasy-football.web.app`.

## Deploying

```
firebase deploy --only hosting          # the app
firebase deploy --only firestore:rules  # the database rules
```

Firebase project: `titan-fantasy-football`, live at
https://titan-fantasy-football.web.app.

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
2. **Done: sync across your own devices.** Google sign-in with Firebase
   (Authentication + Firestore), hosted on Firebase Hosting, which also
   provides the root domain Google Play needs.
3. **In progress: Google Play.** The same web app packaged as a Trusted Web Activity
   with Bubblewrap (`com.titanfantasyfootball.app`), built and signed, and linked to the
   site by `/.well-known/assetlinks.json`. The Play Console account is in verification;
   then come the closed test Google requires of new personal accounts, and production.
4. **Later: more fantasy platforms**, so one Titan account covers every league:
   - **Yahoo Fantasy**: official Fantasy Sports API, signed in with Yahoo (OAuth).
   - **ESPN Fantasy**: no official public API; unofficial endpoints work for public
     leagues, and private leagues need the user's ESPN browser cookies.
   - **NFL Fantasy** and **CBS Sports Fantasy**: need research on what each allows.

   The engine already works on a neutral roster format (`buildLeague` output), so each
   platform needs its own adapter like `sleeper.js`, not a rewrite.

## Save points

| Tag | What it holds |
|---|---|
| `v1.0.0` | Web app for any Sleeper account, Google sign-in sync, the website-only tip jar, the News tab, and the signed Android app |
| `v1.1.0` | Renamed Titan Fantasy Football Manager; FantasyPros rankings; the full title on phones |
