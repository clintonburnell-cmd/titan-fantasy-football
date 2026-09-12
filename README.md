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

Titan's screens sit in five sections: Lineups, Matchup, League (Standings, Rosters, Trade,
Transactions), Players (Waivers, News, Exposure, Byes) and Rankings (Import, Results), with Settings
behind the gear. On phones they're a bar along the bottom; on computers, a menu whose sections drop
down their screens. Each section opens on the screen you used there last, badges show lineup changes
and waiver upgrades, and one league dropdown at the top of the screen narrows every screen that shows
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
team's playoff odds (5,000 simulations of the games left). The Waivers tab gathers pickups for every
league: your rankings' waiver targets, free backups for hurt starters, Sleeper's most-added players
and where each is free in your leagues, a search for where anyone is available, and a suggested bid
where a Sleeper league bids for players (from its recent winning bids).

Titan is white and blue by default. A moon and sun button in the header (and Appearance in
Settings) switches the app and the website to a dark theme, remembered on that device.

The News tab shows ESPN's latest NFL stories, newest first, refreshing every couple of minutes while
it's open. Stories about players on your rosters are marked "Your player", with a filter for just
those, and each story opens on ESPN. With alerts on, Titan also sends "News about your starters":
its server checks ESPN every 15 minutes, all week, and tapping the alert opens the story.

The Trade tab weighs a trade with any team in a league: pick the league and a trade partner, tap
players on both rosters, and Titan totals each side with FantasyCalc's trade values for the league's
format (redraft or dynasty, 1 QB or superflex, team count, PPR), plus a waiver pickup's value for each roster spot an
uneven trade frees (as FantasyCalc's own calculator does), finds trade ideas (fair trades of one or
two players each way that make your starting lineup stronger, and theirs where possible; Clear folds
them away), searches the league for who has a player (Trade for him starts that trade), says who wins and suggests players that would even it out. Copy and open
copies the trade as text and opens your team on Sleeper or ESPN, since neither lets another app fill in an offer. It also shows each team's best
starting lineup by this week's projections before and after the trade, and in dynasty Sleeper
leagues each team's draft picks for the next three drafts (who owns which comes from Sleeper's
traded picks) can go in the trade too. Titan's server fetches the values from
FantasyCalc at most once a day per format, and the tab credits FantasyCalc with a link.

On computers and tablets, the app in a browser takes the website's look: its sections become a
menu across the header, the page is a centred 1100px column (one league per row, as on a phone), the
league chips wrap instead of scrolling (on wider windows the page grows to 1280px and Lineups,
Matchup, Rosters and Results list the leagues down the left side, like Sleeper's website, with the filters
still on top), Settings sits
in two columns, Rosters show as tables, the footer has three columns of links above the tip
jar, the Google account sits at the top right with Settings and Sign out, rows light up under the
pointer, and on wide windows the Titan art sits faded to the right. Phones, the Android app and
home-screen copies keep the app look.

Everywhere, each screen has its own address (`/app/lineups`, `/app/matchup`, `/app/results`, …) and
title, so Back, Forward, bookmarks and shared links work; `firebase.json` rewrites `/app/**` to the
app page. Screens show placeholder cards while they load.

| Screen | What it shows |
|---|---|
| Website | titanfantasyfootball.com: a banner of a Titan lifting a football (`titan.svg`, also on the Play feature graphic), what Titan is, how importing rankings works, a sample lineup, features, privacy and FAQ, with Open Titan and Try a demo buttons, plus three guides under `/guides/` (importing rankings, Sleeper start/sit, adding a private ESPN league). The app itself is at `/app/`. In a browser the address always shows the website; only the Android app and home-screen copies go straight to the app. For search: a title and description with the platforms (Yahoo marked coming soon on the page), `robots.txt`, `sitemap.xml`, structured data (JSON-LD, FAQ included), a 1200 x 630 share image (`og-image.jpg`), and `/app/` marked noindex |
| Lineups | Each league's lineup as set, with a verdict on every slot, the changes to make (with a button that opens the team in Sleeper or ESPN), wire upgrades and injuries. Every player shows his Sleeper headshot and team logo, his kickoff time (in the viewer's time zone) and projection, and once his game starts, his points marked LIVE or FINAL. Tiles count lineup changes, injured starters, wire upgrades, and starters and bench players locked or yet to play. Filters: all, needs action, or one problem at a time (lineup changes, empty spots, out or doubtful, questionable, on bye, unranked starters, wire upgrades); chips at the top jump to any league; each league folds to its header (remembered), with Expand all and Collapse all |
| Matchup | Each league's head-to-head this week, collapsed to a header with both scores and a chance-to-win bar, like Sleeper's; open it for avatars, records, projected totals, and both lineups spot by spot with headshots, points, kickoff times and projections |
| Rosters | Every league's roster in Sleeper's order: the starters spot by spot, then the bench by position (QB, RB, WR, TE, K, DEF), then IR and taxi under Reserve, each with headshot, rank, tier, opponent, bye, kickoff time and live points; a player search (name, team or position), chips that jump to any league, and leagues that fold like Lineups |
| Exposure | Players on two or more of your teams |
| Byes | How many of your players are off each week, per league |
| Results | Any week, 1 to 18: your score against the projection frozen at kickoff, what your rankings would have scored, and the perfect-hindsight score, with a drop-down per league showing each player's frozen rank, call, projection and points (Sleeper and ESPN leagues; ESPN weeks come from ESPN's box score for that week) |
| News | News-only X accounts (@UnderdogNFL), each opening on X. X doesn't let apps read posts without a paid plan |
| Rankings | Import weekly rankings (your own CSV or a sheet paste, Late-Round, FantasyPros, The Hall) and view any saved week by position; until you import, lineups run on the default rankings from Sleeper's projections |
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
stats.js               Website visit counts (Cloudflare Web Analytics; never in the app)
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
