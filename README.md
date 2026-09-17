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

**Try a demo** (`/app/?demo`, linked from the website and the welcome screen) builds two sample
leagues (`demo.js`) from Sleeper's real player list and this week's projections: real players,
kickoff times and injury tags, with a bench back who should start, a weak FLEX, three players on
both teams and a few good free agents. The demo keeps its own storage and never loads sign-in, so it
can't touch a real account. Matchup and Results say they need real leagues.

A Ko-fi tip jar ("Like my work? Consider a tip!") sits at the bottom of every page: the app's
footer, and the end of each website page. The Google Play app opens `/?source=play`, and Titan
hides the tip jar for that session, on the website's pages too, because tips inside a Play app
must use Google Play billing. It's hidden for anyone who links Yahoo as well.

On iPhone and iPad, Titan runs as a home-screen web app (Safari: Share, then Add to
Home Screen). Visitors in the browser see a one-time tip explaining that. From the
home screen, Google sign-in uses a full-page redirect, because iOS home-screen apps
can't hand a popup back. An App Store version is a later step: Apple needs a native
wrapper built on a Mac, Sign in with Apple alongside Google, and features beyond the
website (such as alerts) to pass review.

## Screens

Titan's screens sit in six sections: Lineups, Matchup, League (Standings, Rosters, Trade,
Transactions), Players (Waivers, News, Exposure, Byes), Rankings (Import, Season, Import multiple, and for Titan's owner
Compare and Value report) and Results,
with Settings behind the gear. On phones they're a bar along the bottom; on computers, a menu whose sections drop
down their screens. Each section opens on the screen you used there last, badges show lineup changes
and new waiver upgrades (the dot on Players clears once you've opened Waivers), and one league dropdown at the top of the screen narrows every screen that shows
leagues.

Under the header, a scores ticker shows this week's NFL games: live scores and the clock, final
scores, kickoff times in your time zone, and a count of your starters in each game. Each game opens
on ESPN, whose scoreboard Titan's server reads for everyone (every 30 seconds while games are on).

The Transactions tab lists every trade, waiver claim, free-agent move and commissioner move in your
Sleeper leagues over the last three weeks, newest first, with a league picker (all leagues or one)
and filters for trades, adds and drops, and your own moves (ESPN leagues aren't read yet).

Each starter on Lineups carries his game's context: his team's expected points (from the betting
line on ESPN's scoreboard), whether his matchup is soft or tough (the fantasy points his opponent
gives up to his position, from nflverse's weekly stats), and weather worth knowing at kickoff (from
the National Weather Service). Titan's server builds this once for everyone every half hour.

The Standings tab shows each league's records, all-play records, luck, power rankings and every
team's playoff odds (5,000 simulations of the games left), then Position strength: every team's rank
at QB, RB, WR, TE, K and DEF by its best lineup this season (Sleeper's projections, with a little
credit for bench depth), the league's top third in green and bottom third in red. The Trade tab
sums that up for you and your trade partner, and points out when one's surplus fills the other's
hole. The Waivers tab opens on your waiver plan for the week: in every league, the free agents your
rankings rate above one of your starters, a drop for each (the bench player Titan values least over
the season that you can spare, never someone on IR or your only backup at a position you start; a
list swaps him), a suggested bid where a Sleeper league bids for players (from its recent winning
bids), and a Done check for each claim. Then free backups for hurt starters, Sleeper's most-added
players and where each is free in your leagues, and a search for where anyone is available. Each
pickup shows a line of recent usage (snap share, targets, carries, red-zone looks and points a game
over the last three weeks), and tapping a player's name on Lineups, Rosters, Matchup or Waivers opens
his card: his last four games and his season so far, from Sleeper's stats. An alert (on by default)
reminds you at 8 PM Eastern the evening before your Sleeper leagues' waivers run.

Titan is white and blue by default. A moon and sun button in the header (and Appearance in
Settings) switches the app and the website to a dark theme, remembered on that device.

The News tab shows ESPN's latest NFL stories, newest first, refreshing every couple of minutes while
it's open. Stories about players on your rosters are marked "Your player", with a filter for just
those, and each story opens on ESPN. With alerts on, Titan also sends "News about your starters":
its server checks ESPN every 15 minutes, all week, and tapping the alert opens the story. When ESPN
turns Titan's server away, the tab shows the last stories Titan saved (up to a day old) and says how
old they are; the scores ticker and game context fall back the same way.

The Trade tab weighs a trade with any team in a league: pick the league and a trade partner, tap
players on both rosters, and Titan totals each side with FantasyCalc's trade values for the league's
format (redraft or dynasty, 1 QB or superflex, team count, PPR), plus a waiver pickup's value for each roster spot an
uneven trade frees (as FantasyCalc's own calculator does), finds trade ideas (fair trades of one or
two players each way that make your starting lineup stronger, and theirs where possible; Clear folds
them away), searches every league for who has a player, league by league, or where he's a free agent (tapping a team starts that trade), says who wins and suggests players that would even it out. Copy and open
copies the trade as text and opens your team on Sleeper or ESPN, since neither lets another app fill in an offer. It also shows each team's best
starting lineup by this week's projections before and after the trade, and in dynasty Sleeper
leagues each team's draft picks for the next three drafts (who owns which comes from Sleeper's
traded picks) can go in the trade too. Titan's server fetches the values from
FantasyCalc at most once a day per format, and the tab credits FantasyCalc with a link.
FantasyCalc asks that its numbers stay out of other sites' trade calculators, so outside Titan's
owner's account the Trade tab shows who wins as each team's value change in percent, and the number
beside each player is Titan's own value: his projected points this season above a replacement starter
at his position, in the league's scoring (from Sleeper's season projections). In a dynasty league a
note says so: those numbers are this season only and don't account for age or future seasons.
Both rosters sort by value, by position, or by position then value, and each player's position shows
as a colored tag (QB, RB, WR, TE, K, DEF), as on Lineups. The partner can be changed at the top or
from the heading of their roster card, and Clear all empties the trade, the partner, the trade ideas
and the search for a fresh start. The app page's footer
links FantasyCalc without needing JavaScript, as FantasyCalc asks.

Draft results: See the draft, on the Trade tab, opens the league's draft this season in a pop-up.
Every pick is weighed against its spot: what that pick would get if the draft were held again today,
with every player going in order of value (Titan's own values, or FantasyCalc's on the owner's
account). Teams are graded A+ to D against the rest of the league, best first, each with its best
pick and biggest reach, and open to all their picks, each showing where it went at its position
against where he ranks there by value now ("RB5 taken, RB2 now"). Board shows the draft round by round, a column
per team, steals in green and reaches in amber. It works for Sleeper and ESPN leagues (private ESPN
leagues through Titan's server). Keepers aren't graded, and a draft whose players mostly aren't
projected to start this season (a dynasty rookie draft) shows its board ungraded, except to the owner,
whose FantasyCalc values cover rookies. Back closes the pop-up.

On computers and tablets, the app in a browser takes the website's look: its sections become a
menu across the header, the page is a centred 1100px column (one league per row, as on a phone), the
league chips wrap instead of scrolling (on wider windows the page grows to 1280px and Lineups,
Matchup, Rosters and Results list the leagues down the left side, like Sleeper's website, with the filters
still on top), Settings sits
in two columns, Rosters show as tables, the footer has three columns of links above the tip
jar, the Google account sits at the top right with Settings, Guides and Sign out, rows light up under the
pointer, and on wide windows the Titan art sits faded to the right. Phones, the Android app and
home-screen copies keep the app look.

Everywhere, each screen has its own address (`/app/lineups`, `/app/matchup`, `/app/results`, …) and
title, so Back, Forward, bookmarks and shared links work; `firebase.json` rewrites `/app/**` to the
app page. Screens show placeholder cards while they load.

| Screen | What it shows |
|---|---|
| Website | titanfantasyfootball.com: a banner of a Titan lifting a football (`titan.svg`, also on the Play feature graphic), what Titan is, how importing rankings works, a sample lineup, features, privacy and FAQ, with Open Titan and Try a demo buttons, plus six guides under `/guides/` (importing rankings, combining rankings, Sleeper start/sit, adding a private ESPN league, draft grades, trade help). The app itself is at `/app/`. In a browser the address always shows the website; only the Android app and home-screen copies go straight to the app. For search: a title and description with the platforms (Yahoo marked coming soon on the page), `robots.txt`, `sitemap.xml`, structured data (JSON-LD, FAQ included), a 1200 x 630 share image (`og-image.jpg`), and `/app/` marked noindex |
| Lineups | Each league's recommended lineup (NEW where it differs from yours), then your lineup beside it spot by spot, the differences highlighted and a verdict on each of your players, the changes to make (with a button that opens the team in Sleeper or ESPN), wire upgrades and injuries. Every player shows his Sleeper headshot and team logo, his kickoff time (in the viewer's time zone) and projection, and once his game starts, his points marked LIVE or FINAL. Tiles count lineup changes, injured starters, wire upgrades, and starters and bench players locked or yet to play. Filters: all, needs action, or one problem at a time (lineup changes, empty spots, out or doubtful, questionable, on bye, unranked starters, wire upgrades); chips at the top jump to any league; each league folds to its header (remembered), with Expand all and Collapse all. A week dropdown plans any later week to 18: the lineups as set now, checked against that week's byes, opponents and rankings (imported for it, else Sleeper's projections for it) |
| Matchup | Where you stand across your leagues (winning, losing, close, each a filter), then each league's head-to-head this week, folded to a header with both scores (the leader's green; yours red when you're behind, or purple while you're still projected to win), where you stand in words ("Winning by 14.3", "Projected to win by 9.9" before kickoff, "Won by 12.4" at the end, with players left to play) and a chance-to-win bar; open it for a scoreboard like Sleeper's (pictures, full team names, records, players left, big scores with projections) and both lineups spot by spot, the higher score in each spot in green and players still to play greyed with their projection |
| Rosters | Every league's roster in Sleeper's order: the starters spot by spot, then the bench by position (QB, RB, WR, TE, K, DEF), then IR and taxi under Reserve, each with headshot, rank, tier, opponent, bye, kickoff time and live points; a player search (name, team or position), chips that jump to any league, and leagues that fold like Lineups |
| Exposure | Players on two or more of your teams |
| Byes | How many of your players are off each week, per league |
| Results | Its own section. A week at a time (arrows step through the weeks played and load on their own): the week's points against the projection frozen at kickoff, your record across your leagues, what your rankings would have scored, points left on the bench in hindsight and close calls; the bench's three biggest misses (who sat, who started instead, in which spot); Season so far once two weeks are in (record, points, how your rankings did, and a column chart of each week's points and projection with a table behind it); then every league with won or lost and both scores, opening to each player's frozen rank, call, projection and points. Sleeper and ESPN leagues (ESPN weeks from ESPN's box score); the explanations sit in one fold |
| News | News-only X accounts (@UnderdogNFL), each opening on X. X doesn't let apps read posts without a paid plan |
| Rankings | Import weekly rankings (your own CSV or a sheet paste, Late-Round, FantasyPros, The Hall) and view any saved week by position; until you import, lineups run on the default rankings from Sleeper's projections |
| Compare rankings | Titan's owner only (`/app/compare`, under Rankings): after each week's games, three rankings tested against what happened: Sleeper's projections (the default), FantasyCalc's values as the server saved them before kickoff (`lab/{season}-{week}`, for every format the owner plays; a snapshot saved after kickoff is marked late and sits the week out), and the owner's imports. Lineup points (what each source's lineup would have scored from the owner's rosters, over the leagues every source covers) and order (a rank correlation, −100 to 100, at QB, RB, WR and TE against actual PPR points from Sleeper's stats), week by week and so far. Decides whether FantasyCalc should become the default |
| Value report | Titan's owner only (`/app/value`, under Rankings): the weekly report the owner's PC makes every Tuesday (`D:\Claude\titan-analytics`, outside this repo) and posts to `lab/value-latest`. Each player's projection (nflverse's usage-based expected points, blended with last season early on, plus the skill he's shown) against FantasyCalc's trade value; league by league, sells from positions where the owner is deep, buys from rivals where he's thin, and claims that would start; then the buy-low, sell-high and role-riser lists and every valued player, filterable by position. The league dropdown at the top picks one league: its moves, the lists in its own format (half PPR, superflex dynasty and so on) and who has each player there; under All leagues, a chip for each format. A player search narrows the moves and every table, and each table's header row follows the page down to the table's end, with the player column staying in view when a table scrolls sideways |
| Data dump | Titan's owner only (`/app/data-dump`, under Rankings after Value, and separate from it): the spreadsheet the owner downloads each Tuesday (`week<N>-data-dump.xlsx`: player usage and expected points, defense by position, schedule strength, team tendencies), which the owner's PC posts to `lab/dump-latest` within the hour (titan-analytics' `run-dump.ps1`). League by league, ideas: who to start from next week's matchups, free agents to pick up, buys from rivals, sells from the owner's roster, and playoff schedules worth weighing. Then buy and sell from expected points, soft and tough matchups, the schedule outlook (next four and the fantasy playoffs), every player by expected points, and team tendencies. It follows the league dropdown (a Where column) and shares the value report's search and position chips |
| Import multiple sources | Several rankings combined into one list for a week (`/app/multiple`, under Rankings): add each source as a file or paste (a source can be several files, like FantasyPros' per-position ones), weight any at 1x to 3x (remembered by name), and optionally count Titan's default rankings. Each position is averaged on its own, a source that leaves a player out counting him just below its last player there, and RB, WR and TE are fitted onto one FLEX list the way the sources with an overall list do it. Each player shows his place in every source, with a mark where they're 8 or more spots apart. Saved as the week's rankings, with its sources, so it can be re-weighted later |
| Settings | Linked Sleeper account, ESPN leagues and login, which leagues Titan manages, refresh log; for Titan's owner only (the account with the `titanOwner` custom claim), a Titan stats card with totals from the `ownerStats` function |

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
- **Game-day alerts** (signed-in people choose them per device in Settings): a starter ruled out,
  with who Titan would start instead, and a lineup check 45 to 80 minutes before each kickoff (after
  inactives) for starters ruled out or on bye and empty spots. `SCC.alertsFor` decides; the server
  job sends them through Firebase Cloud Messaging every 15 minutes on game days, and at noon, 4 PM
  and 8 PM Eastern on other days for players ruled out; `sw.js` shows them. Each alert goes out once.
  **Send a test alert** (Settings, once alerts are on) sends one to that device (the `testAlert` function).
- **Feedback and terms:** the app's footer has a Feedback link (an email with the screen and device
  filled in) and the Terms of Use (`terms.html`), which every page links.
- **Behind the scenes:** daily Firestore backups (kept 7 days) and an email to the owner when a server
  function logs an error, both set up in Google Cloud.
- **The week moves on Tuesday.** Once a week's games are over, the Tuesday after the last
  one (Eastern time) Titan shows the next week, even if Sleeper hasn't moved yet: scores
  clear and the upcoming projections show. A game still to be played holds the week.
- **Chance to win** on Matchup is Titan's estimate: points so far plus what each player's
  projection still expects, with the uncertainty of points still to come
  (`winProbability` in `engine.js`).
- **Folded leagues are remembered per tab.** Lineups and Rosters start open, Matchup
  starts folded; only a person's own taps are saved, not the search opening a league.
- **Team names read "Nickname (account name)"** on every tab, in Sleeper and ESPN leagues alike
  (`teamLabel` in `engine.js`). A team without a nickname shows the account name alone.
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
- **Cloudflare Web Analytics** counts visits to the website's pages (home, guides, privacy,
  terms) without cookies (`stats.js`). The app, the Android app and home-screen copies never load it.
- **ESPN's public NFL schedule** (`proTeamSchedules_wl`) gives every kickoff time. The
  device reads it for everyone, Sleeper-only users included, and keeps it 12 hours.
- **ESPN** (`lm-api-reads.fantasy.espn.com`, the JSON ESPN's own site reads; not a
  documented API): public leagues are read from the device. Private leagues need the
  member's `espn_s2` and `SWID` cookies, which a browser can't send to ESPN, so the
  person saves them through the `espnLogin` callable function, which keeps them in
  `espnCreds/{uid}` where no browser can read them, and the `espnLeague` callable
  reads the league with them and returns a slimmed copy.

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
site/                  Everything the browser loads (Firebase Hosting publishes this folder and nothing else):
  index.html             The website; app/index.html is the app's page at /app/
  styles.css, site.css   The app's and the website's styling
  engine.js              Start/sit, wire, exposure, bye, scoring and win-chance rules (pure; no page or network code)
  sleeper.js             Sleeper API calls, league discovery, refresh and browser storage
  espn.js                ESPN leagues: reading them and matching their players to Sleeper's
  app.js                 Screens and interactions
  sw.js                  Service worker: offline shell, installable app
  stats.js               Website visit counts (Cloudflare Web Analytics; never in the app)
  manifest.webmanifest   App name and icons for installing
  icon*.svg / icon*.png  App icons (the PNGs are rendered from the SVGs)
  privacy.html           Privacy policy
functions/             Server: freezes each week's calls at kickoff; reads private ESPN leagues; the /api feeds
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
   site by `/.well-known/assetlinks.json`. The Play Console account is verified (Sept 10, 2026);
   next come the closed test Google requires of new personal accounts, and production.
4. **More fantasy platforms**, so one Titan account covers every league:
   - **Done: ESPN Fantasy** (`espn.js`) for lineups, rosters, exposure, byes and the
     kickoff record; public leagues by ID, private ones with the member's saved ESPN
     login. Next: ESPN leagues on the Results tab.
   - **In progress: Yahoo Fantasy**: official Fantasy Sports API, signed in with Yahoo (OAuth),
     with a server-side token exchange. Titan's Yahoo app is registered and its access request is with
     Yahoo. Linking a Yahoo account and Yahoo leagues on Lineups, Rosters, Exposure, Byes and Waivers
     are built, visible only to Titan's owner until Yahoo approves and a real league works end to end;
     next, Matchup, live scores, Standings, Trade and Results.
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
| `v1.8.0` | A real website at titanfantasyfootball.com (a Titan banner, a sample lineup, rankings import explained, features, privacy, FAQ) with the app moved to `/app/`: anyone already using Titan and the Android app go straight to the app, and `/?home` shows the website; a new Play feature graphic with the Titan |
| `v1.8.1` | titanfantasyfootball.com always opens the website in a browser, even with a saved account (Open Titan leads to the app); only the Android app and home-screen copies go straight to `/app/` |
| `v1.9.0` | Search basics: a title and description naming Sleeper, ESPN and Yahoo (Yahoo marked coming soon on the page), `robots.txt`, `sitemap.xml` (submitted in Search Console), structured data with the FAQ, a Titan share image for link previews, `/app/` kept out of search results; privacy policy clause for a change of owner |
| `v1.10.0` | ESPN leagues on the Results tab; Try a demo (two sample leagues of real NFL players, kept apart from any account); game-day alerts (a starter ruled out, and a lineup check before each kickoff) through Firebase Cloud Messaging; a Titan stats card for the owner (totals only); three search guides; "not affiliated with the NFL" in every footer |
| `v1.11.0` | Send a test alert; a Feedback link and a Terms of Use page; accessibility 100 on the website, guides and app (contrast, headings, underlined links, no layout jumps); the demo loads about four times faster (names from the week's projections); daily database backups and an error email set up in Google Cloud |
| `v1.12.0` | The website look on computers and tablets: a menu-style header, a centred 1100px page with one league per row, the Titan art faded to the right, an address per screen (`/app/lineups`, `/app/rosters`...), the Google account at the top right, Rosters as tables, league chips that wrap, a three-column footer with the tip jar, loading placeholders, row hover and focus outlines; phones and the Android app keep the app look |
| `v1.12.1` | On wider computer windows the page grows to 1280px and Lineups, Matchup, Rosters and Results list the leagues down the left side, like Sleeper's website (each links to its card and the one in view is marked; the filters stay on top); Expand all and Collapse all on Results |
| `v1.13.0` | A Trade tab: pick a league and a trade partner, tap players (and, in dynasty Sleeper leagues, draft picks) on both rosters, and Titan weighs the trade with FantasyCalc's values for the league's format (stars weighted), says who wins, suggests players to even it out and shows each team's best lineup this week before and after; values come through Titan's server (`/api/trade-values`, cached a day), credited to FantasyCalc. Also each league's picture with a lettered site badge next to every league name |
| `v1.13.1` | The Trade tab weighs trades the way FantasyCalc's own calculator does: plain value totals (FantasyCalc's values already count stars for more) plus a waiver pickup's value, about the 300th-best player, for each roster spot an uneven trade frees |
| `v1.14.0` | Live ESPN news on the News tab (through Titan's server at `/api/news`), stories about your players marked with a filter for them, and news alerts for your starters (checked every 15 minutes, all week; the alert opens the story); white and blue by default with a dark mode switch (moon/sun in the headers, Appearance in Settings) across the app and website; a taller header on computers; Trade before Rankings |
| `v1.15.0` | Five additions from a look at the big fantasy sites: a Standings tab (records, all-play, luck, power rankings, playoff odds from 5,000 simulations); trade ideas on the Trade tab (fair trades that make your starters stronger); one lineup-check alert for all leagues, and a ruled-out starter's free backup named in his alert; a Waivers tab (waiver targets, free backups, Sleeper's trending adds and where each is free, a where-is-he-available search, suggested waiver bids); and game context on every Lineups starter (team's expected points, soft or tough matchup, weather at kickoff) |
| `v1.15.1` | A Transactions tab (every trade, waiver claim, free-agent move and commissioner move in your Sleeper leagues over the last three weeks, with a league picker and filters); on the Trade tab, Clear folds the trade ideas away and Who has him? searches the league's rosters, then free agents |
| `v1.15.2` | Copy and open on the Trade tab (copies the offer as text and opens your team on Sleeper or ESPN, since neither lets another app fill one in); Transactions reloads every five minutes while it's open |
| `v1.15.3` | Website visit counts with Cloudflare Web Analytics (`stats.js`), without cookies, on the home page, guides, privacy and terms only: never in the app, the Android app or home-screen copies; the privacy policy says so |
| `v1.15.4` | Team names read "Nickname (account name)" on every tab (Matchup, Standings, Trade, Transactions), in Sleeper and ESPN leagues alike, or the account name alone when a team has no nickname (`SCC.teamLabel`); private ESPN leagues get their managers' names on Standings too |
| `v1.16.0` | Yahoo, step 1: Sign in with Yahoo in Settings (Titan's owner only while it's built), the tokens kept on Titan's server where no browser can read them, and the person's Yahoo leagues listed with their team in each (Titan's access request is with Yahoo); the service worker leaves Titan's server addresses (`/api/...`) to the browser, which fixed an ERR_FAILED coming back from Yahoo's sign-in |
| `v1.16.1` | Yahoo, step 2a (owner-only, waiting on Yahoo's approval): each refresh reads every Yahoo league through Titan's server and shows it on Lineups, Rosters, Exposure, Byes and Waivers, players matched to Sleeper's list (matching now shared with ESPN in `engine.js`); Matchup, Standings, Trade and Results say Yahoo is coming next; the tip jar hides for anyone who links Yahoo, Yahoo is credited where its data shows, and a saved refresh over a day old drops its Yahoo leagues |
| `v1.17.0` | An NFL scores ticker under the app's header: this week's games from ESPN's scoreboard through Titan's server (`/api/scores`, one shared read kept 20 seconds), with live scores and clocks, kickoff times in your time zone, a count of your starters in each game, and each game opening on ESPN; the "Titan server problems" alert now watches all 13 server functions |
| `v1.18.0` | Five sections instead of thirteen tabs: Lineups, Matchup, League (Standings, Rosters, Trade, Transactions), Players (Waivers, News, Exposure, Byes) and Rankings (Import, Results), with Settings behind a gear. A bar along the bottom on phones and in the apps, a header menu with dropdowns on computers, sub-tabs at the top of each screen, each section reopening on its last screen, badges for lineup changes and waiver upgrades, and one league dropdown steering every screen that shows leagues. Also: news alerts read Titan's own `/api/news` first, since ESPN had started refusing the game-day job |
| `v1.18.1` | The tip jar moves to the bottom of every page: the app's footer (out of the header), the website's footers and the end of privacy and terms; the website's pages hide it inside the Play app too. A real cog for Settings, and a narrow phone's header says just Titan |
| `v1.19.0` | The Trade tab on FantasyCalc's terms (their email, 2026-09-12): Titan's owner still sees FantasyCalc's numbers; everyone else sees who wins as each team's value change in percent, Titan's own value beside each player (projected season points above a replacement starter, from Sleeper's season projections), picks without a number, and in dynasty leagues a note that those values are this season only. The app page links FantasyCalc in its HTML, and the website lists Trade help and Standings |
| `v1.19.1` | The Players dot works like a notification: it marks waiver pickups you haven't seen on Waivers yet, clears once you open Waivers, and comes back only for a new pickup (remembered on each device) |
| `v1.19.2` | Trade tab: both rosters sort by value, by position, or by position then value (with position headers when grouped, remembered), and every player shows Titan's colored position tag on the rosters, in the trade and in Who has him? |
| `v1.19.3` | Position strength: every team's rank at each position by its best lineup this season (Sleeper's projections, a little credit for bench depth), shown on Standings with the top third green and the bottom third red, and on the Trade tab as "Where you both stand" for you and your partner, with the good fits called out; the Trade tab also gets Clear all and a partner picker on the partner's roster card |
| `v1.73.0` | The matchup sheet feeds the calls (the owner's ask, after a bad start/sit read off the sheet alone). `matchRank` prefers the week's Match Up data sheet over the game context's own points-allowed ranks wherever a matchup is read: the close-call tilt (`tiltFor`), the close-call note's "softer matchup" line, the player card's read and the compare view. The sheet's rank is the same measure from his own source, per week, so `SCC.matchupRank` (the Overview table's "FP/G <pos>" column) and `SCC.tiltFromRank` (the eight softest spots up `MATCH_TILT` 8%, the eight toughest down, the middle nothing) are pure and tested, and both the app and the extension's worker read them. The tilt's ceiling and `TILT_MARGIN` are unchanged, so a sheet can still only flip a genuinely close call, never a wide one; a wide disagreement goes to the "projections disagree" note instead. The tilt now runs on a sheet alone when the game context is missing. The extension (v0.5.0) reads `lab/matchups-<season>` and passes the same tilt to `analyzeAll`, so its marks agree with Titan's calls. Measured against the owner's twelve leagues in week 2: two close calls, neither clearing the margin, and no disagreement notes, which is the expected shape since his weekly rankings are matchup-aware already; the close-call grading will say by week 5 whether the bar should move |
| `v1.72.0` | Match Up data (Rankings, after Data dump; the owner and the titanLab accounts, the owner's ask: "add a new tab under rankings, label it Match Up data and let it be uploaded week by week"). The owner's weekly matchup sheets, three tables an NFL week (Overview: team and game totals, the spread, pass rate over expected, pace, points allowed by position; Passing: PROE, EPA a dropback, pressure rate, aDOT, target share allowed by position; Rushing: PROE, EPA a rush, rush success, rushing points allowed to QBs and RBs), one row per offense with its opponent, ranks 1 to 32 shaded green (the best matchup) to red, value columns by their range, and a dot on the teams your starters play for. Week chips and table chips. Uploaded week by week: the owner pastes each sheet as text (a header row, then one row an offense; `SCC.parseMatchups`, pure and tested) into the screen's form, or runs `node upload.js matchups <season> <week>` in titan-analytics on TSVs in its reports/matchups/. Kept as `lab/matchups-<season>` (`labJson`, `labWrite` in sync.js; the rules let the owner write it and titanLab read it). Week 2 of 2026 posted from the owner's three images |
| `v1.71.1` | Kickers for kickers, defenses for defenses on the waiver plan (the owner's rule). A kicker or defense claim, which the rankings already raise only when the free agent outranks the one you start, now drops the spare kicker or defense on the bench, else the very one he outranks, and never an open roster spot or a skill player; the drop dropdown lists that position only, and the plan's note says so. A kicker whose game has started can't be swapped, so the claim names nobody. Engine tests cover the three cases |
| `v1.71.0` | Five more, three on the site and two in the extension. **The weekly recap** (Today, `recapCard`): last week as Results scored it, in one card: the record and points, the close calls right with the tilt's flips apart, and the bench's biggest miss (`keepWeek` now keeps `miss`; Today scores last week quietly if Results hasn't). The owner's Tuesday briefing leads with the same line (`pushRecap` writes `users/{uid}/private/recap` when the app scores the week just ended; `recapLine` in the function reads it; a rule for the path). **Compare two players** (`openCompare`, `compareHtml`): "Compare with…" on any player card opens Find a player for the second; the same dialog then shows both side by side in the league picked: your rankings' rank note, this week's projection with floor and ceiling, the matchup with the tilted projection, the next four weeks with the schedule, the rest of the season with Titan's value, recent usage, and where each stands in your leagues, with a read at the end (who your rankings favor, whether it's a close call, whether the projections agree or disagree by `DISAGREE`). Swap keeps the second and asks for a new first. **Paste an offer** (Trade, `SCC.parseOffer` pure and tested, `applyOffer`): "give A, B get C", "A and B for C", "I give my A for your B", "Team X offered A for your B" all read; the rosters settle whose side is whose (an offer written from the other team swaps), the partner is whoever holds what you'd get, and the trade fills in through the same path a sent trade takes, with what it read and any name it couldn't place said back. **Extension v0.4.0**: Titan's lineup marks on the page's names (start in green, bench in red, the reason and rank note on hover; a mark-only pill for players the reports don't value) and a free agent's bid with the claim's drop on his pill |
| `v1.70.0` | Four for sharper calls. **Projections disagree** (Lineups, `disagreeNotes`, `SCC.disagreements`): when a bench player's matchup-tilted projection beats a starter's at his position by `DISAGREE` (3) points or more while your rankings put them well apart (a different tier, or more than a few ranks), a note says so with both projections and the rank numbers; the call still follows your rankings, and the note is the cue to check the news. Only with your own rankings for the week. **Close calls, graded** (Results, `callsCard`): `recordCalls` keeps each week's close calls as they stood before kickoff (KEY.calls: the pick, the other, whether the matchup tilt made it, both projections; a pair with a locked player stays as recorded, one that stops being close is dropped), `SCC.gradeCalls` scores them against the points once both have played, the rankings' calls and the tilt's flips counted apart, and `keepWeek` carries each finished week's totals so the card adds the season up (from ten flips it says whether the tilt is earning its keep). **Next four weeks**: a row on the Trade tab's impact table and a Next 4 column on the Value report (`sosNext4`: the next four weeks' average opponent rank for points given up to his position from Schedule strength, a tilt of up to 8% either way on the Trade row, the rank shown beside the Value points; `loadSos` now loads for those tabs too). **A nudge before kickoff** (extension v0.3.0, `SCC.kickoffNudge`): ninety minutes before a player's kickoff, with a change or a hurt starter still standing, one Chrome notification names the leagues and the moves, once per kickoff slot; the worker reads this week's kickoff times from `/api/scores` into its analysis (so its flex spots take the latest kickoffs as in the app) and each move's players carry `kick` |
| `v1.69.0` | Overall ranks past the end of the list (the owner: on "Yours vs recommended" Wicks showed WR47 and only a tier, because his overall list stops before him). A wide file's FLEX list is the overall scale; players beyond it carried a 1000+ sentinel that ordered them by position rank alone (TE25 ahead of WR47 whatever the positions are worth). `extendOverall` now continues each position's line past the list (the slope of position rank against overall rank from the listed pairs), always behind everyone listed and in position order, and marks the row `est`; the note reads "#131 overall (estimated) · WR47 at position · tier 10". So FLEX comparisons past the list weigh the positions, and every rank line shows an overall number. A position with fewer than three listed players keeps the sentinel |
| `v1.68.2` | The rank note on the "Make these changes" rows too (the owner's screenshot: OUT Wicks WR47 / IN Sadiq TE25 with no note): both the out and the in player carry it, and Copy changes includes it |
| `v1.68.1` | The overall rank everywhere a rank shows (the owner: "can you also post what their OVERALL rank is?", Wicks 131 and Juwan Johnson 128): Today's waiver and hurt-starter lines, the extension popup's Today lines and its panel's waiver and hurt lines now carry the rank note (#131 overall · WR45 at position · tier 7) beside the label |
| `v1.68.0` | Four of the five "do all of these" improvements (the fifth, the backtest, is titan-analytics v1.12.1: `backtest.py` replays each playbook rule on 2024 against 2025 and the nudges it read against move a call by 4% instead of 12%). (1) **Today**, a new first tab of Lineups: every league's lineup changes with both players' ranks and notes, hurt starters and waiver upgrades, plus for the owner the Value report's claims (with the drop), buy-lows and sell-highs and the Data dump's start ideas, each with a done check kept per week (`S.ui.todo`) and an Open button that picks the league; the extension's popup lists the same lines. (2) **Trade-partner activity**: `SleeperAPI.leagueTradeCounts` counts completed trades by team this season; the partner picker and "Partners who fit" say who deals. (3) **The dynasty prospect prior** (analytics `capital_tier`): in a player's first two seasons his draft tier outranks his rookie-year points; day three is never a buy on one season. (4) **The Scorecard page** (`/scorecard/`, linked from the site's nav): the grader's aggregates, posted to `public/scorecard` each Tuesday (`upload.js scorecard`); "first grades arrive after week 4" until then |
| `v1.67.2` | The extension's player card shows the team's volume, the room, a back's game-script snaps and a passer's deep balls (analytics v1.12.0's numbers) |
| `v1.67.1` | On Lineups' "Yours vs recommended" the benched player shows his rank and note beside the recommended one, and the extension's change lines name both players' ranks and notes (the owner's ask) |
| `v1.67.0` | The extension, "do all" of the five suggestions: (1) a game-day badge on its icon, lineup changes plus hurt starters across every league, refreshed every twenty minutes and on browser start, with the leagues to fix listed in the popup; (2) a player card on any pill (projection, market and edge, usage, workload, the league's call with its drop, the Late-Round note, the guide take, and a button to put him in the trade check); (3) a bid on every free agent's card from the league's FAAB history and what he adds over your lowest starter at the position; (4) a Matchup section on league pages (both sides' projected finals, chance to win, and the lineup's close calls with projections, rank notes and a favorite/underdog lean, from `SleeperAPI.collectMatchups` and `SCC.winProbability` run in the worker); (5) Propose on Sleeper, assisted: names the partner and the pieces, copies them, and marks each player's pill give or get on Sleeper's pages until Done. Titan never drives Sleeper's trade screen |
| `v1.66.0` | The rank note on lineups (the owner's ask: "a NOTE with people's OVERALL RANK AND their TIER next to it ... how close they are in rank/tier and positional rank"): every ranked starter on Lineups and in the extension's Lineup section carries `SCC.rankNote` under his rank label ("#17 overall · RB9 at position · tier 2"; a quarterback, kicker or defense has no overall; a rank past the overall list shows the position only), and each close-call note states the pair's overall ranks, position ranks and tiers. The weekly map and `attachRanks` now carry the file's position rank (`posRank`); `SCC.rankBits` is the pure helper |
| `v1.65.1` | Two fixes from the owner using the extension: a trade sent to the Trade tab "shows for a second then flickers off" (the app's refresh on load reloads the league's teams, and the Trade tab reset the picks while the list was empty; it now waits for the list), and picking a name in the extension's trade check "moves me back to the top" (the panel re-renders and now keeps its scroll and the box being typed in) |
| `v1.65.0` | A `titanLab` role (the owner asked to share the owner tabs with a friend; only Compare rankings is shareable, since the Value report and Data dump carry his leagues and his paid draft guide): an account with the claim sees Compare rankings alone, the rules let it read the lab's weekly snapshots (`lab/<season>-<week>`) and nothing else in `lab/`; granted by `titan-analytics/grant-role.js <email> titanLab` (firebase-tools login, never touches the owner's claims). `App.setOwner(is, lab)` |
| `v1.64.0` | The extension runs Titan's lineup engine itself (the owner's "go ahead and do it"): its service worker (now a classic worker importing the bundled Firebase, `engine.js` and `sleeper.js`) reads his Sleeper leagues with `SleeperAPI.collect`, his synced weekly rankings from Firestore, Sleeper's projections for the defaults, and runs `SCC.analyzeAll`; the panel's Lineup section shows the recommended lineup by slot with ranks, the changes the rankings want, hurt starters and waiver upgrades, cached twenty minutes with a Refresh. Tested with a stand-in analysis in headless Chrome; the pipeline smoke-tested under Node |
| `v1.63.0` | The extension's panel links to Titan's Lineups, Waivers and Value for the league on screen (`?league=<id>` now picks a league in the app's dropdown), beside its Start ideas and Claims (bid and drop). The extension sends a trade to Titan's Trade tab (the owner's ask: "copy and paste and send to titanfantasyfootball trade analyzer"): with both sides picked, a button opens `/app/trade?trade=<league>:<give ids>:<get ids>`; the app keeps it in `S.trade.pending` until that league's teams load, then picks the partner (the team holding the players you'd get), fills the builder and scrolls to the summary. The address is cleaned up afterwards |
| `v1.62.1` | The trade check moves to the top of the extension's panel, in its own box (the owner couldn't see it at the bottom) |
| `v1.62.0` | The extension's panel gets a trade check (the owner asked whether it "can analyze trades"): type the players you'd give and get, and it totals each side's market value, Titan's worth (the market's value moved by the projection's edge) and points a game with a verdict; a link to Titan's Trade tab for the lineup-level analysis. titan-analytics v1.11.1 adds the market value (`v`) to the report's rows for it |
| `v1.61.1` | The extension's league panel sits at the top right (just under Sleeper's header) instead of the bottom right, the owner's ask |
| `v1.61.0` | Titan for Sleeper, a Chrome extension for the owner (`extension/`, loaded unpacked; its README has the steps): pills after player names on sleeper.com (the edge on the market, buy/sell/keep/claim, a back's archetype; the projection, the reason, the Late-Round note and the guide take on hover) and a panel on league pages (start ideas, claims with the drop and a FAAB bid from the league's winning bids, pickups, buy-lows, sell-highs with keep/sell, the watch list). Signs into Titan through `site/ext/connect.html` (Google sign-in on Titan's own site hands the extension a credential of its own); reads the owner-only reports over Firestore's REST API. Never writes to Sleeper. Tested in headless Chrome for Testing (`tests/extension.test.js`; branded Chrome ignores `--load-extension`) |
| `v1.60.0` | The Value report shows the Late-Round playbook (titan-analytics v1.11.0, built from 42 of JJ Zachariason's research episodes): a Late-Round pill on each valued row with the playbook's note on him, and a Workload column (a back's carries and targets a game with his archetype, a passer's rushing points and touchdown rate, a receiver's yards a target). The calls' reasons say "Late-Round: ..." |
| `v1.59.1` | The owner's Tuesday briefing (the Value report's push) says when his season lists are six days old or more, or none are saved: the rest-of-season rankings behind them refresh every Tuesday, so it's the cue to re-import. Also found and fixed: the server tests (`tests/functions.test.js`) had been skipping silently since the site/ move in v1.44.0 (they looked for `site/functions`); they run again and pass |
| `v1.59.0` | From the week-2 Late-Round Q&A: a kicker or defense waiver bid never tops 3% of the budget (a stream), the Value report's claims put free agents at your thin positions first (bench where you're weak), and the Guide pill says when a take is an in-season one rather than the draft guide's (titan-analytics v1.10.1) |
| `v1.58.0` | Tiers over rankings: with tiers on your season list, players in the same tier are pulled three quarters of the way to their tier's average value (and points), so tier-mates trade about even and the real cliffs sit between tiers; with tiers on your weekly rankings, a close call on Lineups is two players in the same tier, whatever their rank gap, and different tiers are never one, so the matchup tilt and the floor/ceiling notes only ever weigh tier-mates |
| `v1.57.0` | Trade ideas count a player's status and leave quarterbacks out of the ideas in one-QB leagues (a quarterback is easy to find, so a QB-for-QB swap isn't worth the churn): an out or IR player's rest-of-season points start after the weeks his status says he'll miss (out or doubtful a week, IR or PUP four, a suspension three, since Sleeper gives no return date), an idea says when a player it brings in is out and for about how long, shows what it does to your lineup this week, and ranks lower the more it costs you now, so you keep winning while you improve; the trade rosters show each player's status |
| `v1.56.0` | Trade ideas respect your starting positions: an idea never weakens a position you aren't deep at (you trade from depth), the partner's side is judged by the public projections (what they see) while yours follows your rankings, and a package that upgrades more than one of your positions by your numbers ranks higher and says so ("upgrades your RB and WR by your numbers") — a swap that reads even to them and two upgrades to you |
| `v1.55.0` | Your season rankings are the Trade tab's points source: with a list saved for a league's kind, the rest-of-season and playoff points behind trade ideas and the before/after lineup table follow your order (each player you rank gets the points of the player the projections rank where you rank him; players off your list keep their projection), and the tab says so. Without a list, Sleeper's season projections as before |
| `v1.54.2` | Trade ideas balance points and value again: an idea must add rest-of-season points to your best lineup and gain value by your own numbers (the market's price plus your season rankings' or the usage's edge), and ranks by both (a 5% gain in value counts like a point a week); only a consolidation that adds a point a week or more may give up a little value. v1.53.0 had ranked by points alone, which pushed your own rankings out of the order |
| `v1.54.1` | The Trade tab has its own League dropdown beside Trade partner, and both pickers appear again right above the trade (the You give / You get box and the rosters), so switching leagues or partners never means scrolling back to the top; the Trade tab's league picker also moves the dropdown at the top when that names a league |
| `v1.54.0` | The draft guide's lens (owner only): a Guide pill on the Value report, the Data dump and the Trade tab's rosters says whether the owner's draft guide had a player as one to target, to avoid or a late-round dart, with its confidence, the thesis and what to watch this season on hover (hollow once he came off the list); the Value report's calls rank a buy the guide agrees with, or a sell it agrees with, higher, and a call it argued against lower, saying why (titan-analytics v1.9.0; the digest stays private) |
| `v1.53.0` | Trade ideas now chase the best starting lineup: every idea must add rest-of-season points to your best lineup and is ranked by how many (a fair price is the constraint, so a two-for-one that turns your depth into a starter counts even when it gives up a little value), each idea leads with the points it adds and per week, and the card names the partners whose rosters fit yours (thin where you're deep, deep where you're thin), with ideas that draw on a partner's depth ranked as an easier yes. The Value report's position pills now say "9th projection · 10th your list" and explain themselves |
| `v1.52.0` | The Value report and the Data dump now read your season rankings (titan-analytics v1.8.0 pulls the lists you saved on Season import out of Titan before each run): each league card shows where you stand at every position as colored position pills, by projection and by your own list, with thin and deep decided by your list when you have one; a claim needs your list to rank the free agent above the starter he'd replace, and a quarterback or tight end claim needs a drastic gap (4 and 3 projected points a game) since a starter there isn't worth churning |
| `v1.51.4` | Rankings' Season rankings sub-tab is now Season import |
| `v1.51.3` | Rankings' Import sub-tab is now Weekly import, so it reads apart from Season rankings |
| `v1.51.2` | Season rankings: each kind-of-league chip (and Standard / TE Premium) carries a status dot, green with a list saved, amber when your leagues use that kind and no list is saved yet, hollow grey when none of your leagues is that kind, with a legend under the chips |
| `v1.51.1` | Every claim on the Value report and the Data dump says who to drop for him: the bench player worth the least (the lowest trade value on the market, then the lowest projection; the Data dump goes by expected points), never a kicker or defense, each claim taking a different one; a drop pill sits beside the claim's name (titan-analytics v1.7.1) |
| `v1.51.0` | Route share, the number JJ Zachariason puts above everything for pass catchers, built from nflverse's participation data (who was on the field for each dropback): the Value report shows each receiver's, tight end's and back's route share and his targets and yards per route (last season's in grey until this season's is published), a receiver's or tight end's role is read by route share, and one running routes on under 40% of dropbacks is never a buy-low (titan-analytics v1.7.0). Fixes sync across devices, which had failed with permission-denied since the security release: the rules checked the document ID on collection reads, which a list query can't satisfy |
| `v1.50.0` | The game counts: Lineups close calls now tilt for the betting line (a team expected to score more than the average side lifts its players, up to 10%) beside the matchup, and say which team is expected to score more; the Data dump's start/sit, pickup and buy calls read the same lines (a new Team pts column) and give a back on a big favorite a little more. The Value report shows each player's goal-line role (a back's share of the carries inside the 10, a pass catcher's end-zone targets), steadies a week's usage toward a normal play count, reads a tight end's role by target share, keeps a touchdown scorer whose goal-line work is real, and lists young players already in a real role among the risers (titan-analytics v1.6.0, from seven Late-Round episodes). Fixes a v1.5.0 bug that read a quarterback's kneel-downs as garbage-time touches |
| `v1.49.0` | The Value report shows each back's rush share and every player's share of touches in garbage time, and explains the model behind titan-analytics v1.5.0 (the Late-Round digest): garbage-time touches count a quarter toward usage and a player with 40% of his touches there is never a buy-low; last season's weight in the usage blend goes by how much one week says about a position (receivers and quarterbacks most, backs least); the Data dump's early-season margins by position the same way |
| `v1.48.0` | Season rankings (Rankings, Season): save your own rest-of-season or dynasty rankings for each kind of league (1QB or superflex, redraft or dynasty, each with a TE Premium list), and each league uses the one that matches it. Your rankings set your own player values on the market's scale while the market still decides what's fair, so trade ideas hunt for players you rank above their price; they also pick the waiver plan's drops, grade drafts and rank Position strength |
| `v1.47.2` | Open in Sleeper on Android phones opens the league on sleeper.com instead of an app link: Sleeper's app won't take league links, so the old app link sent phones to the Play Store even with Sleeper installed |
| `v1.47.1` | The owner's briefing says in the logs why it sent nothing, so a quiet trigger can be told apart from one that never ran (the first live briefings went out for week 2) |
| `v1.47.0` | Every league card on Lineups and Rosters opens with where your roster is deep or thin, your playoff odds and seed, and what the two suggest: trade from your depth, fix a hole on waivers, patch it before the playoffs, or sell veterans when the odds are long |
| `v1.46.0` | Standings under All leagues leads with your playoff odds in every league (best first, division leads marked, a tap opens the league's full standings); the Value report's leagues come in the app's own order, like every other tab |
| `v1.45.0` | Division winners in the playoff odds and the playoff picture (Sleeper's and ESPN's seeding; ★ marks today's division leaders); a Tuesday briefing on the owner's phone when the Value report and Data dump post (the counts and the top calls); Titan's own values tilt by age in dynasty leagues; Yahoo leagues' scoring beyond receptions; ESPN leagues on the Transactions tab (written to ESPN's format, not yet checked on a real league) |
| `v1.44.0` | The website and app move into `site/`, the only folder Hosting publishes (URLs unchanged), so the repo root, the server and the tests are never served; a Content-Security-Policy in report-only mode on every page, with reports to `/api/csp`, to be enforced once the logs stay clean |
| `v1.43.0` | Find a player from any screen (the magnifier in the header: every NFL player, where he is in each league, his card a tap away); Schedule strength under Players (each NFL team's remaining opponents ranked by the points they give up to a position, over the next four weeks, the rest of the season and the fantasy playoffs, with your players on each team); Standings' playoff picture (your game's win-or-lose odds, then who to root for in every other game this week by the swing in your playoff chance); Copy changes on Lineups (the moves as text); the player card ends with his latest ESPN news; the Value report and Data dump tables share one builder |
| `v1.42.0` | Sharper calls: on a close call (a bench player within 12 ranks of a starter at his position) the matchup tilt can flip the spot when the bench player projects 1.5 more with the matchups counted (+8% against the softest defenses, -8% against the toughest), and the card says why; waiver bids scale with the points a claim adds over the starter he replaces and how many other teams would start him, with the reasons under the bid; Exposure lists the players you lean on most first (by lineups started in); the player card gets "Titan's read": this week's floor and ceiling, his rest-of-season value, the matchup, and (owner) the Value report's usage rank against the market with its call. titan-analytics gains `score_calls.py`, which grades past calls against what happened once two finished weeks follow a report |
| `v1.41.0` | Floor and ceiling: on Lineups, each close call (a bench player within 12 ranks of a starter at his position) gets a note with both players' floor and ceiling (the projection give or take the player's usual swing, from his recent weeks steadied by his position's), who has the softer matchup, and a lean: the higher floor when you're the favorite this week, the higher ceiling as the underdog; the recommended lineup still follows the rankings. Matchup shows each side's range (floors to ceilings of the starters yet to play). Playoff odds use each team's own swing, steadied by the league's. Position strength grades deep and thin against the league's average (0.6 standard deviations), not by thirds |
| `v1.40.0` | Trade tab, batch B: two-for-two trade ideas; in dynasty and keeper leagues each team's stance from its playoff odds (contending, rebuilding), draft picks in the ideas for rebuilding partners, and a line saying what to offer; "to even it out" leans toward a position the other side is thin at; a bye check warns when a trade leaves a week with an empty starting spot or notes one it clears; Titan's own values count the rest of the season (byes out), read between the players either side of the replacement spot, with the flex spots shared out the way the league's teams fill them |
| `v1.39.0` | Trade edge: the Trade tab reads the numbers behind the market. The impact table shows each team's best lineup this week, the rest of the regular season and the playoff weeks (byes out); an edge line under the verdict says what Titan's own values make of a market-fair trade; trade ideas must not lower your rest-of-season points, count the partner's thin positions, who gets the best player and two-starters-for-one asks in their order, and say so. For Titan's owner: the Value report's usage edge (what the market would pay if it agreed with usage, against its price) on the edge line and in the ideas' ranking, buy/sell/keep tags and momentum notes on the trade rosters, and the playoff weeks tilted by the Data dump's playoff schedule |
| `v1.38.0` | Value report and Data dump (owner only): the sell-high lists are "Sell high or keep", and every sell-high carries a verdict, a keep tag when the role behind the points is a real starter's (or the points come from yards on a proven skill), sell when it's thin; the models weigh what matters more (titan-analytics v1.3.0: value-aware gaps so a few spots at the top of a position count for more than the same spots deep in it, last season by position and by how far the role moved, touchdown luck carrying little, the matchup by position in the Data dump, buys ranked by how real the role is). Each report's note explains it |
| `v1.37.0` | Each league's own scoring, beyond PPR: projections keep Sleeper's stat line, and a league's points add its differences from Sleeper's standard scoring (6-point passing TDs, TE premium, first downs, bonuses, ESPN's -2 interceptions), so default rankings, lineup calls, projected totals, win chances, Titan's trade values and position strength all follow the league. Standard and PPR leagues are unchanged. Each league's description names 6-pt pass TDs and TE premium |
| `v1.36.0` | The app half of the 2026-09-15 review: the screen repaints in place, so focus, sideways scroll, open menus and photos survive the live tick; the service worker serves the app's files from its saved copy at once and refreshes them behind (a slow connection can't stall the app), with every site page saved for offline; storage is pruned (old projections, older combined weeks' source rows, the old account's refresh) and a full device is told once; coming back after five minutes does a cheap update, a full refresh waits for half an hour; Matchup shows each side's projected final once games start; Standings and Trade lose their second league picker and screens that show every league say so while a league is picked; Byes follow the league dropdown; planning a week Sleeper hasn't projected yet says so; Results keeps the week showing when the next hasn't kicked off and retries a failure; dialogs return focus, the needs-action dot is announced, a skip link in the app, the link-more-leagues chips lose their broken tab roles; scripts load deferred; searches index names once; dead handlers removed |
| `v1.35.0` | The security release from the 2026-09-15 site review. Server: a saved ESPN login moves to `espnCreds/{uid}`, where no browser can read it (logins saved before are moved on first read); account deletion runs on the server in one go (`deleteMyAccount`); every outside read has a timeout; the game-day job works eight people at a time inside a 450-second budget and names anyone it couldn't reach, reads only accounts with alerts on away from game days, skips accounts unseen for 45 days, writes a week's record only when it changed, caps alerts and ESPN leagues per person; the public `/api` addresses refuse made-up parameters. Firestore rules are explicit per path, big fields are exempt from indexing, and every response carries security headers. Website: signup boxes work without JavaScript and hide only on a joined device; a Menu on phones; Guides and Weekly email in every header; privacy and terms on the site template with rights, retention, governing law and the weekly email; breadcrumb and article data on the guides with a "last checked" date; a skip link and reduced-motion guard; a custom 404 page; the title leads with the keyword and no longer promises Yahoo; "No ads, no ad tracking" |
| `v1.34.1` | On an Android phone (and Titan's Play app), Open in Sleeper and the trade's Copy and open ask the Sleeper app for the league's team page first, with the web page as the fallback; Sleeper's iPhone app takes only chat links, so iPhones and computers keep the web page |
| `v1.34.0` | Lineups leads with what each lineup should look like: the recommended lineup (NEW where it differs), then yours and the recommended one side by side, spot by spot, the differences highlighted; one line when they already match. The step list stays above |
| `v1.33.3` | A pop-up after every newsletter signup, on the website and in the app: "Subscription successful. Check your email to finish", with the spam-folder reminder and an OK button |
| `v1.33.2` | Docs, no change to the site: the Titan Waiver Wire now reaches Kit as a draft each Tuesday (titan-analytics' `newsletter_send.py`, Kit's API), for the owner to send there; the first issue (week 2) went out on 2026-09-15 |
| `v1.33.1` | The Data dump's leagues come in the same order as every other tab (the app's own league order), not by name |
| `v1.33.0` | A Data dump screen for Titan's owner, under Rankings after Value: the spreadsheet the owner downloads each Tuesday, turned by titan-analytics into ideas for each league (start leans from next week's matchups, pickups, buys, sells, playoff schedules) and lists (buy and sell from expected points, soft and tough matchups, schedule outlook, every player, team tendencies), posted automatically within the hour of the download. Also: the sub-tab row scrolls to the screen that's open |
| `v1.32.1` | "Check your spam or promotions folder" after every signup, and in the newsletter page's fine print |
| `v1.32.0` | New subscribers get this week's Titan Waiver Wire right away: the page Kit's confirmation link opens (`/newsletter/?joined=1`), and any joined device, shows the latest issue, which titan-analytics posts each Tuesday to Firestore `public/waiver-wire-latest` (readable by anyone, so usage picks only). The welcome note now says "You're in", and the privacy policy mentions the read |
| `v1.31.1` | Links to the weekly email that stay for everyone, joined or not: a "Free weekly email" pill beside the app's title on wider screens, and "Weekly email" in the app's footer and in the footer of the home page and every guide |
| `v1.31.0` | The Titan Waiver Wire's signups switched on (Kit's form 9921118 in `newsletter.js`, so every signup box shows: home page, `/newsletter/`, guides, the app's Waivers and Settings). Trade's "Who has him?" searches every league: each player found shows, league by league, the team that has him (tap it to open that trade), yours, or free agent. And Results opens on the week just played from Tuesday until the new week's first kickoff, instead of an empty week |
| `v1.30.0` | A week dropdown on Lineups: this week, then every week to 18, each later week a plan (your lineups as set now, checked against that week's byes, opponents and rankings: imported for it, else Sleeper's projections for it), without this week's game tiles, game lines or live scores |
| `v1.29.0` | The Titan Waiver Wire, a free weekly email: signup boxes on the home page (under the main buttons and in a section of their own), a `/newsletter/` page, the end of every guide, and cards on the app's Waivers and Settings, all posting to Kit's form and hidden until its form number is set; the privacy page covers the list |
| `v1.28.2` | Docs tidy, no change to the site: CLAUDE.md regrouped by area (Start here, Never, code and data, look and type, screens, Trade and FantasyCalc, the owner's screens, server, Yahoo, website) with every rule kept word for word, and a private RESUME.md (gitignored, never deployed) as the place to pick up |
| `v1.28.1` | A "Developed by Titan Forge" credit (titanforgedev.com) at the bottom of every page: the website's home and guides, the app's footer, and privacy and terms |
| `v1.28.0` | Inter across the whole app (the website keeps the system font): every screen in Inter, drawn at the system font's letter height so every phone layout keeps its fit, weights capped at bold so nothing reads heavier than the Value report, report-style headers on the data tables (Rosters on computers, Standings, Position strength, Results, Compare), and names in tables keep normal hyphens; each screen keeps its tuned sizes. The UI test photographs all 14 screens at phone and computer widths to compare looks |
| `v1.27.0` | Value report typography: Inter (served by Titan itself, SIL Open Font License), four text sizes and three weights, same-width numbers in tables and tiles, small uppercase table headers, names bolder than their stats, and the Where column left-aligned; tables a step smaller on phones |
| `v1.26.3` | Value report: each table's header row follows the page as you scroll, sitting just under Titan's header until the table ends (before, it stayed only at the top of the table's own box, which could slide under the header) |
| `v1.26.2` | Value report: a player search (name, team or position) that narrows the moves and every table, and tables that keep their header row and player column in view as you scroll them |
| `v1.26.1` | Value report: the league dropdown picks one league (its moves, the lists in its own format, and a Where column saying who has each player: yours, a rival's team, or a free agent); under All leagues, a chip for each of your league formats, that format's leagues first |
| `v1.26.0` | Value report for Titan's owner, under Rankings (`/app/value`): the weekly buy-low, sell-high and claims report from the owner's PC (titan-analytics), posted every Tuesday to `lab/value-latest` and shown league by league, with the buy, sell and role-riser lists and every valued player |
| `v1.25.1` | The scores ticker reads ESPN's scoreboard in the browser when ESPN turns Titan's server away, and the server answers unavailable instead of failing, so ESPN's refusals no longer set off the Titan server problems alert |
| `v1.25.0` | Waiver day: a waiver plan at the top of Waivers (claims from your rankings, a drop for each that you can swap, bids, a Done check), a line of recent usage on each pickup (snap share, targets, carries, red-zone looks, points), a player card from any name (his last four games and his season from Sleeper's stats), and an alert at 8 PM Eastern the evening before your Sleeper leagues' waivers run |
| `v1.24.3` | Matchup: your score turns red when you're behind, or purple while you're behind but still projected to win (the status line says so too); a league without a picture shows the Titan icon instead of a football, its site's badge still in the corner |
| `v1.24.2` | Guides in the account menu at the top right on computers, under Settings |
| `v1.24.1` | Three new guides for search (combining rankings, draft grades, trade help), linked from the guides page, the import and Sleeper guides, and the sitemap |
| `v1.24.0` | Compare rankings for Titan's owner (Sleeper's projections, FantasyCalc and the owner's imports tested each week by lineup points and order, from a FantasyCalc snapshot the server saves before each week's games); the website, import guide, FAQ, sitemap and Play listing brought up to date (draft results, combining rankings, news, alerts, waivers, won or lost on Results) |
| `v1.23.0` | Results becomes its own section (a sixth button on phones, a menu tab on computers) and a cleaner screen: week arrows that load on their own, a week summary (points, record, what your rankings would have scored, points left on the bench, close calls), the bench's biggest misses, Season so far with a column chart and its table, won or lost with both scores in every league (ESPN too), and the explanations in one fold |
| `v1.22.0` | Import multiple sources, under Rankings: several rankings (files or pastes, a source made of several files if need be) combined into one list for a week, each position averaged on its own with missing players counted just below each list, sources weighted 1x to 3x, Titan's default rankings optional, RB/WR/TE fitted onto one FLEX list from the sources' overall lists; each player's place in every source shown, splits marked; saved as the week's rankings with its sources |
| `v1.21.0` | A clearer Matchup tab: a summary of where you stand across leagues (winning, losing, close) whose counts filter the leagues; each league says where you stand in words ("Winning by 14.3", "Projected to win by 9.9", "Won by 12.4") with the leader's score green and the trailer's grey; opened, a scoreboard like Sleeper's with pictures, full names, records, players left and big scores; in the lineups, the higher score in each spot is green and players still to play are greyed with their projection |
| `v1.20.1` | Draft results show each pick's place at its position against its place there by value now ("RB5 taken, RB2 now"), on each team's picks and when pointing at a pick on the Board |
| `v1.20.0` | Draft results on the Trade tab: See the draft opens the league's draft in a pop-up, every pick weighed against its spot by today's values (Titan's own, FantasyCalc's for the owner), each team graded A+ to D with its best pick and biggest reach, and a Board view round by round; Sleeper and ESPN leagues, private ESPN leagues through Titan's server; a dynasty rookie draft shows ungraded by Titan's values; Back closes it |
| `v1.19.4` | When ESPN turns Titan's server away (it started answering 403 on 2026-09-12), the News tab, scores ticker and game context serve their last good copy, saved in Firestore, instead of failing: news up to a day old, with a note on the News tab once it's over 15 minutes old; scores up to half an hour; game context up to six hours. News alerts skip an old copy and ask ESPN directly |
