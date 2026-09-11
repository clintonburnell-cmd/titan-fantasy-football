# Titan Fantasy Football Manager

Start/sit calls, waiver upgrades, exposure and bye weeks across every Sleeper
and ESPN league you play in, ordered by your own rankings.

Link a Sleeper username (no password needed) and add ESPN leagues by ID. Titan
finds your leagues and their lineup formats, then compares the lineups you have
set with the ones your rankings would start.

It grew out of a personal tool, the Sleeper Command Center, and uses the same
start/sit rules, made to work for any Sleeper account.

## How it works

1. **Link**: enter a Sleeper username. Sleeper's public API returns the user ID,
   and every refresh re-reads the user's leagues, including each league's lineup
   slots, team count and scoring. A commissioner's format change is picked up
   automatically. ESPN leagues are added by league ID or link (`espn.js`): the
   person picks their team (or Titan finds it from their saved ESPN login), and
   every ESPN player is matched to the same player in Sleeper's list by name and
   position, so injuries, locks, rankings and projections work the same way.
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
| Lineups | Each league's lineup as set in Sleeper, with a verdict on every slot, the changes to make, wire upgrades and injuries; chips at the top jump to any league |
| Matchup | Each league's head-to-head this week: both teams' scores and projections, then your lineup and your opponent's spot by spot, with points, kickoff times and projections |
| Rosters | Every rostered player per league, with rank, tier, opponent and bye; a player search (name, team or position) and chips that jump to any league |
| Exposure | Players on two or more of your teams |
| Byes | How many of your players are off each week, per league |
| Weeks | Any week, 1 to 18: your score against the projection frozen at kickoff, what your rankings would have scored, and the perfect-hindsight score, with a drop-down per league showing each player's frozen rank, call, projection and points (Sleeper leagues; ESPN scoring is next) |
| News | News-only X accounts (@UnderdogNFL), each opening on X. X doesn't let apps read posts without a paid plan |
| Rankings | Import and manage weekly rankings |
| Settings | Linked Sleeper account, ESPN leagues and login, which leagues Titan manages, refresh log |

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
- **Sleeper** is read directly from the device (`api.sleeper.app`).
- **ESPN** (`lm-api-reads.fantasy.espn.com`, the JSON ESPN's own site reads; not a
  documented API): public leagues are read from the device. Private leagues need the
  member's `espn_s2` and `SWID` cookies, which a browser can't send to ESPN, so the
  person saves them to `users/{uid}/private/espn` and the `espnLeague` callable
  function reads the league with them and returns a slimmed copy.

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

## Server job

`functions/index.js` is a scheduled Cloud Function (`freezeCalls`). Every 15 minutes on NFL
game days it runs, for each person who signed in to sync, the same engine the app uses
(`engine.js`, `espn.js` and `sleeper.js`, copied in before each deploy): their live Sleeper
and ESPN rosters (private ESPN leagues with their saved login) under their synced rankings,
plus Sleeper's projections for the week. It saves the result
to `users/{uid}/history/{week}` with `freezeWeek`, which keeps rewriting a player's entry
until his game kicks off and never after. The Weeks tab scores each week against that
frozen record. Scheduled functions need Firebase's pay-as-you-go (Blaze) plan.

Projections come from Sleeper's projections feed, which Sleeper licenses from RotoWire
and doesn't officially document; the app says "Projections via Sleeper".

## Testing

```
node tests/run.js                  # every test; the account-based ones skip without TITAN_SLEEPER_USER
node tests/run.js engine espn      # just some of them
```

No test needs private data. Rankings come from `tests/fixtures/sample-rankings.csv` (built from
Sleeper's public player order), ESPN test leagues are built from ESPN's public player list and
never touch a real league, and a real Sleeper account is read from the `TITAN_SLEEPER_USER`
environment variable. `functions.test.js` needs `npm install` in `functions/` once, and
`ui.test.js` needs Chrome.

## Deploying

```
firebase deploy --only hosting          # the app
firebase deploy --only firestore:rules  # the database rules
firebase deploy --only functions        # the kickoff freezer (Blaze plan)
```

Firebase project: `titan-fantasy-football`, live at
https://titan-fantasy-football.web.app.

## Files

```
index.html             Page shell
styles.css             All styling
engine.js              Start/sit, wire, exposure, bye and scorecard rules (pure; no page or network code)
sleeper.js             Sleeper API calls, league discovery, refresh and browser storage
espn.js                ESPN leagues: reading them and matching their players to Sleeper's
app.js                 Screens and interactions
sw.js                  Service worker: offline shell, installable app
manifest.webmanifest   App name and icons for installing
icon*.svg / icon*.png  App icons (the PNGs are rendered from the SVGs)
privacy.html           Privacy policy
functions/             Server: freezes each week's calls at kickoff; reads private ESPN leagues
tests/                 node tests/run.js (see Testing)
CLAUDE.md              Working notes for Claude Code: rules, commands, Windows quirks
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
4. **More fantasy platforms**, so one Titan account covers every league:
   - **Done: ESPN Fantasy** (`espn.js`) for lineups, rosters, exposure, byes and the
     kickoff record; public leagues by ID, private ones with the member's saved ESPN
     login. Next: ESPN leagues on the Weeks tab.
   - **Next: Yahoo Fantasy**: official Fantasy Sports API, signed in with Yahoo (OAuth),
     with a registered Yahoo developer app and a server-side token exchange.
   - **Later: NFL Fantasy** and **CBS Sports Fantasy**: need research on what each allows.

   The engine works on a neutral roster format (`buildLeague` output), so each platform
   is an adapter that produces it, like `sleeper.js` and `espn.js`, not a rewrite.

## Save points

| Tag | What it holds |
|---|---|
| `v1.0.0` | Web app for any Sleeper account, Google sign-in sync, the website-only tip jar, the News tab, and the signed Android app |
| `v1.1.0` | Renamed Titan Fantasy Football Manager; FantasyPros rankings; the full title on phones |
| `v1.2.0` | Weeks tab (weeks 1 to 18, calls and projections frozen at kickoff by the server job), saved-rankings viewer, projections on Lineups, bye-week needs per league, ESPN leagues (public and private), and Link more leagues in Settings |
