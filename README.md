# Titan Fantasy Football Manager

One place to manage every fantasy football league you play, across Sleeper and ESPN,
with start/sit calls built on rankings you import yourself.

Titan is built for two things. First, one stop for all your leagues: link a Sleeper
username (no password needed) and add ESPN leagues by ID, and every league's lineup,
matchup, roster, injuries, byes and live scores sit together. Second, your own rankings:
import them as a CSV (your own spreadsheet, Late-Round, FantasyPros, The Hall) and Titan
compares every lineup with the one your rankings would start, then lists the swaps and
waiver pickups to make. Until you import, it uses Sleeper's weekly projections.

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
   FLEX file gives the overall ranks FLEX slots need. The Hall's weekly rankings (`Rank,
   Team, Player, Fantsy Position, Matchup, ...`) are one overall list of every position,
   so they're read as they are; its IDP rows are skipped.
   **Default rankings:** until a week has rankings imported, Titan ranks players by
   Sleeper's weekly projections (RotoWire's numbers) in each league's own scoring, with
   QB, RB, WR and TE on one overall scale and K and DEF each on their own. An import takes
   over, and the defaults fill only the positions it leaves out (`defaultRanks` and
   `rankingsBy` in `engine.js`). The server job's weekly record follows the same rule.
3. **Follow the calls**: every lineup slot gets a verdict (OK, SWAP OUT,
   DO NOT START, UNRANKED, LOCKED), with the exact swaps to make, ranked free
   agents nobody in the league has, and injured starters.

Sleeper is read-only. Titan can't set lineups, claim waivers or trade. Each league has an
Open in Sleeper (or Open in ESPN) button that goes to that team's page to make the changes.

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
| Lineups | Each league's lineup as set, with a verdict on every slot, the changes to make (with a button that opens the team in Sleeper or ESPN), wire upgrades and injuries. Every player shows his Sleeper headshot and team logo, his kickoff time (in the viewer's time zone) and projection, and once his game starts, his points marked LIVE or FINAL. Tiles count lineup changes, injured starters, wire upgrades, and starters and bench players locked or yet to play. Filters: all, needs action, or one problem at a time (lineup changes, empty spots, out or doubtful, questionable, on bye, unranked starters, wire upgrades); chips at the top jump to any league; each league folds to its header (remembered), with Expand all and Collapse all |
| Matchup | Each league's head-to-head this week, collapsed to a header with both scores and a chance-to-win bar, like Sleeper's; open it for avatars, records, projected totals, and both lineups spot by spot with headshots, points, kickoff times and projections |
| Rosters | Every league's roster in Sleeper's order: the starters spot by spot, then the bench by position (QB, RB, WR, TE, K, DEF), then IR and taxi under Reserve, each with headshot, rank, tier, opponent, bye, kickoff time and live points; a player search (name, team or position), chips that jump to any league, and leagues that fold like Lineups |
| Exposure | Players on two or more of your teams |
| Byes | How many of your players are off each week, per league |
| Results | Any week, 1 to 18: your score against the projection frozen at kickoff, what your rankings would have scored, and the perfect-hindsight score, with a drop-down per league showing each player's frozen rank, call, projection and points (Sleeper leagues; ESPN scoring is next) |
| News | News-only X accounts (@UnderdogNFL), each opening on X. X doesn't let apps read posts without a paid plan |
| Rankings | Import weekly rankings (your own CSV or a sheet paste, Late-Round, FantasyPros, The Hall) and view any saved week by position; until you import, lineups run on the default rankings from Sleeper's projections |
| Settings | Linked Sleeper account, ESPN leagues and login, which leagues Titan manages, refresh log |

## Rules worth knowing

- **Rankings are the only order**: your imported ones, or the default rankings for a
  week or position you haven't imported. Unranked players sit last. Out, Doubtful and
  IR players sit below even unranked ones, and so does a player on bye that week:
  a starter on bye gets ON BYE and his backup goes in.
- **Locks follow Sleeper.** Each player locks at his own game's kickoff. A
  locked starter keeps his slot, and a locked bench player can't come in.
- **Latest kickoff in FLEX.** Of the players Titan would start, the latest kickoffs go in
  SUPER_FLEX and FLEX and earlier ones in RB, WR and TE, so a late scratch can still be
  covered from the bench. A lineup starting the right players the other way round gets one
  change: a swap of spots. Players whose game has started never move.
- **Supported slots:** QB, RB, WR, TE, FLEX, W/R flex, W/T flex, SUPER_FLEX, K,
  DEF, plus basic IDP slots. Best-ball leagues start switched off, because
  Sleeper sets their lineups itself.
- **Byes come from Sleeper's schedule**, so they stay right every season.
- **A player whose game has started is left alone.** He shows LOCKED or his score, is
  never swapped out, and no waiver pickup is offered over him; free agents whose game
  has started aren't suggested either. New rankings that leave him out keep his old rank.
- **Live scores**, in each league's own scoring, come from Sleeper's matchups and ESPN's
  box scores. While games are on they update about every minute with Lineups open (every
  couple of minutes on Matchup, and ESPN's larger box scores every other minute).
- **The week moves on Tuesday.** Once a week's games are over, the Tuesday after the last
  one (Eastern time) Titan shows the next week, even if Sleeper hasn't moved yet: scores
  clear and the upcoming projections show. A game still to be played holds the week.
- **Chance to win** on Matchup is Titan's estimate: points so far plus what each player's
  projection still expects, with the uncertainty of points still to come
  (`winProbability` in `engine.js`).
- **Folded leagues are remembered per tab.** Lineups and Rosters start open, Matchup
  starts folded; only a person's own taps are saved, not the search opening a league.
- **Saved data carries a version.** An older snapshot on a device is refreshed on open,
  so a new field (like kickoff times) never waits for a manual refresh.

## Where data lives

- **On the device** (`localStorage`): the linked Sleeper username, league
  switches, rankings, the last refresh and a trimmed player list. Titan works
  fully on one device without signing in.
- **In the person's own account, if they sign in with Google** (Firebase
  Authentication + Cloud Firestore, `nam5`): `users/{uid}` holds the Sleeper
  link and league switches, and `users/{uid}/ranks/{week}` holds each week's
  rankings. `firestore.rules` lets only that signed-in person read or write
  their own data.
- **Sleeper** is read directly from the device (`api.sleeper.app`); player headshots,
  team logos and avatars load from Sleeper's image server (`sleepercdn.com`).
- **ESPN's public NFL schedule** (`proTeamSchedules_wl`) gives every kickoff time. The
  device reads it for everyone, Sleeper-only users included, and keeps it 12 hours.
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
`titanfantasyfootball.com` and the Firebase Hosting domains (each is an authorized domain
in Firebase Auth and on the Google OAuth client); the GitHub Pages address forwards to
`titanfantasyfootball.com`.

## Server job

`functions/index.js` is a scheduled Cloud Function (`freezeCalls`). Every 15 minutes on NFL
game days it runs, for each person who signed in to sync, the same engine the app uses
(`engine.js`, `espn.js` and `sleeper.js`, copied in before each deploy): their live Sleeper
and ESPN rosters (private ESPN leagues with their saved login) under their synced rankings,
plus Sleeper's projections for the week. It saves the result
to `users/{uid}/history/{week}` with `freezeWeek`, which keeps rewriting a player's entry
until his game kicks off and never after. The Results tab scores each week against that
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

Firebase project: `titan-fantasy-football`, live at https://titanfantasyfootball.com (the
domain is registered at Porkbun and verified in Google Search Console; `www` forwards to it).
https://titan-fantasy-football.web.app serves the same site and stays: the Android app is
tied to it, and anything saved on a device without signing in stays with the address it was
saved on.

## Files

```
index.html             Page shell
styles.css             All styling
engine.js              Start/sit, wire, exposure, bye, scoring and win-chance rules (pure; no page or network code)
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
     login. Next: ESPN leagues on the Results tab.
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
| `v1.3.0` | Matchup tab like Sleeper's (collapsible leagues, scores and a chance-to-win bar, both lineups); live and final scores; the Tuesday week switch; kickoff times; headshots and team logos; game-status tiles; league jump chips and a Rosters player search; players whose game has started left alone; Weeks renamed Results; tests in the repo and CLAUDE.md |
| `v1.4.0` | Lineups filters by problem (lineup changes, empty spots, out or doubtful, questionable, on bye, unranked starters, wire upgrades) and an ON BYE call for starters on bye; Rosters in Sleeper's order (starters by spot, bench by position, IR and taxi under Reserve); fold and unfold leagues on Lineups and Rosters, with Expand all and Collapse all everywhere |
| `v1.5.0` | The Hall's weekly rankings import (one overall list; its misspelled position column, @ matchups and LVR read correctly; IDP rows skipped), with the source named in the import message |
| `v1.6.0` | Titan's home moves to titanfantasyfootball.com (Google sign-in there; the web.app address stays for the Android app), and default rankings from Sleeper's weekly projections in each league's scoring, used until a week's rankings are imported and for any position an import leaves out |
| `v1.7.0` | Latest kickoffs in FLEX: Titan's lineup puts the latest-playing starters in the flex spots and earlier ones at RB, WR and TE, listing a swap of spots when a lineup has them the other way round; changes shown spot by spot with kickoff times; an Open in Sleeper (or ESPN) button on every Lineups league |
| `v1.7.1` | Lineups score line: points so far in soft green, projection in bold; every description (welcome screen, header, Rankings tab, page and install descriptions, Play listing, README) leads with Titan's two purposes: one place for leagues across platforms, and calls from the rankings you import |
