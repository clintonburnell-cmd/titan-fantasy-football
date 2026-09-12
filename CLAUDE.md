# Titan Fantasy Football Manager: working notes for Claude

A static web app (no build step, no dependencies) plus two Firebase Cloud Functions. Live at
https://titanfantasyfootball.com (Porkbun domain on Firebase Hosting; also served, and kept, at
https://titan-fantasy-football.web.app, where the first Android test build pointed; never redirect it.
The Android app opens titanfantasyfootball.com/app/?source=play since the v1.11.0 build)
(Firebase project `titan-fantasy-football`, Blaze plan);
code at github.com/clintonburnell-cmd/titan-fantasy-football. The Google Play app is a Trusted Web
Activity kept outside this repo (`D:\Claude\titan-android`, with `PLAY-LISTING.md`); it loads the
live site, so site changes reach it without a new upload. What's done and what's next lives in
`README.md` (Roadmap, Save points), not here.

## Where things are

| File | What it does |
|---|---|
| `index.html`, `site.css` | The website at the root: what Titan is, features, FAQ. In a browser it always shows the website (the owner's call: never forward browser visitors, even with a saved account). Only the Android app's `/?source=play` and home-screen copies go to the app, keeping the query; `/?home` shows the website even there |
| `titan.svg` | The Titan banner art (hand-drawn vector). The Play feature graphic (`titan-android/store/feature-graphic.html`) and the share image `og-image.jpg` (`titan-android/store/og-image.html`) use it too: re-render both after changing it |
| `robots.txt`, `sitemap.xml` | For search engines. `/app/` stays out of results through its noindex tag, not robots.txt (a block would hide the tag). Add new website pages to the sitemap, and keep the home page's structured data (JSON-LD) FAQ identical to the visible FAQ |
| `demo.js` | "Try a demo" (`/app/?demo`): two sample leagues built from Sleeper's player list and this week's projections |
| `app/index.html` | The app's page, at `/app/`. It loads every file by absolute path (`/app.js`, `/styles.css`) |
| `engine.js` | All the rules, pure (runs in the browser, in Node tests and in the server job): rankings parsing, start/sit, waiver ideas, exposure, byes, projections, kickoff freezing, weekly scoring |
| `sleeper.js` | Sleeper API, the refresh (`collect`) for Sleeper and ESPN leagues, browser storage |
| `espn.js` | ESPN adapter: reads leagues, turns them into `buildLeague`'s shape, matches players to Sleeper ids |
| `app.js` | Screens and interactions |
| `sync.js` | Google sign-in, Firestore sync, the saved ESPN login, the private-ESPN transport (ES module) |
| `syncplan.js` | Which copy wins when syncing (pure) |
| `functions/index.js` | `freezeCalls` (every 15 minutes on game days) and `espnLeague` (reads private ESPN leagues) |
| `tests/` | `node tests/run.js` |

## Rules

- **Never write the owner's personal Sleeper username or Sleeper user ID into this repo**, a commit
  message, a screenshot or the Play listing. Tests read a real account from the
  `TITAN_SLEEPER_USER` environment variable. Before every commit, `git grep -i` for the username
  and ID (they're in Claude's memory; ask the owner if not).
- Never commit paid rankings (Late-Round exports) or anything from `titan-android`'s keystore and
  password files. Test rankings come from `tests/fixtures/sample-rankings.csv`.
- Tests must never read a real person's ESPN league: serve ESPN requests with `stubEspn` or
  Chrome's request interception, as the existing tests do.
- Keep `engine.js` free of page and network code.
- A change to `engine.js`, `espn.js` or `sleeper.js` needs the functions redeployed too: the
  predeploy step copies them into `functions/shared/`.
- Adding a file the app loads: add it to `SHELL` in `sw.js` and bump `CACHE`.
- The Android app opens `/?source=play`. The website's forward to `/app/` (with the query) must
  keep working, or the Play app shows the website instead of the app.
- Titan's owner is the one sign-in account with the `titanOwner` custom claim. `ownerStats`
  refuses everyone else and returns totals only: never add per-person details to it.
- Alerts: `SCC.alertsFor` decides (pure, tested), `alertUser` and `deliver` in `functions/index.js`
  send Firebase Cloud Messaging data messages to the tokens in `users/{uid}/private/alerts`, and
  `sw.js` shows them. Keep each alert's key stable, or people get repeats: `out|week|league|player|tag`
  (names the starter's backup when he's a free agent there: depth chart order is index 3 of each
  trimmed player), `check|week|kickoff` (one alert covering every league), `news|week|story|player`.
- Wide browser windows (900px and up) get the website look from the "website look" block in
  `styles.css`: a menu-style header, a centred 1100px page with one league per row (the owner prefers
  that to two across, and centred to set left), league chips that wrap, a footer row, from 1100px a 1280px page where Lineups,
  Matchup, Rosters and Results list their leagues down a sticky left side (`jumpBar` hands them to `sideNav`,
  and the chips hide; the filters stay on top), and from 1200px the faded Titan art fixed to the right. It's scoped
  to `html:not(.in-app)`, so phones, the Android app and home-screen copies keep the app look.
  Check new screens at 390px and at 1280px. On computers Rosters draws tables (`rosterTable`,
  when `wide()`); keep `data-find` on every row so the player search still works.
- The News tab reads ESPN's public NFL news feed (`ESPN.fetchNews`, site.api.espn.com; unofficial, so
  keep the link back to each story) through Titan's server (`espnNews` at `/api/news`, one shared read
  kept 90 seconds, CDN two minutes: ESPN's bot protection turns some browsers away, headless Chrome
  included, and refuses CORS preflights) every two minutes while open, marking stories that tag players on
  the person's rosters. News alerts: each alert check saves the person's starters (`SCC.newsWatch`) as
  `watch` in their alerts doc; `newsAlerts` runs on every 15-minute run all week, reads the feed once
  and only looks at people when a new story tags a player (`SCC.newsAlertsFor`, at most 3 at a time,
  key `news|week|story|player`). A news alert's tap opens the story (sw.js).
- The Trade tab uses FantasyCalc's trade values. Their terms: call only `/values/current`, cache on
  Titan's server (the `tradeValues` function keeps each format in Firestore `tradeValues/{format}` for a
  day; the app reads `/api/trade-values`, never FantasyCalc), and credit FantasyCalc with a visible link
  to fantasycalc.com wherever the values show. Keep the credit line on the tab. The owner judged the tip
  jar not commercial use; selling Titan would need FantasyCalc's written permission. The trade summary
  also shows each team's best lineup by this week's projections before and after (`SCC.lineupPoints`),
  and dynasty Sleeper leagues list each team's next three drafts' picks (`SCC.draftPicks` from
  `/traded_picks`, rounds 1 to 4) at FantasyCalc's plain pick values; ESPN doesn't share pick trades. Sides add up plainly (FantasyCalc's
  values already count stars for more, so don't add a star bonus) plus FantasyCalc's roster-spot
  adjustment: a waiver pickup (`SCC.waiverValue`, about the 300th-best player) per spot freed. Trade
  ideas (`SCC.tradeIdeas`): fair 1-2 player trades that raise the value of your best starters
  (`lineupPoints` with values, not one week's projections), at most two per partner.
- Game context on Lineups rows (`SCC.gameTags`) comes from the `gameContext` function at
  `/api/game-context` (kept 30 minutes): ESPN's scoreboard lines (`ESPN.scoreboardFrom`,
  `SCC.impliedTotals`), NWS forecasts at kickoff for outdoor US games (`STADIUMS` holds each home
  stadium's spot; NWS needs a User-Agent), and points allowed by position (`SCC.dvpFrom` over
  nflverse's `stats_player_week_<season>.csv.gz`, CC BY 4.0, credited on Lineups; last season's
  until three weeks are played; Firestore `meta/dvp`, 12 hours).
- The Transactions tab (tab id `moves`, address `/app/transactions`): each Sleeper league's last three
  weeks of completed transactions (`API.leagueTransactions` → `SCC.transactionsFrom`), reloaded after
  five minutes. ESPN transactions aren't read yet (their format hasn't been checked on a real league).
- The Waivers tab: rankings' wire targets (`L.wire`), free backups (`SCC.backupOf`), Sleeper's
  trending adds (`API.trendingAdds`) with where each is free (`L.takenNorm`), a search, and bids
  (`SCC.faabBid` from `API.leagueWaivers`: a Sleeper league's last six weeks of winning bids).
- The Standings tab (`SCC.standings`): records, all-play, luck, power and playoff odds from 5,000
  seeded simulations; schedules from `API.leagueSchedule` (Sleeper matchups, or ESPN via
  `ESPN.fetchSchedule`; private ESPN leagues through `espnLeague` kind `schedule`).
- Two themes: white and blue by default, and dark (`theme.js` sets `data-theme="dark"` on `<html>`,
  remembered in localStorage `titan.theme`; a moon/sun button in the headers, and Appearance in
  Settings). Every colour that differs between them is a token in both `:root` blocks of `styles.css`
  (no raw colours for text or surfaces), and text meets WCAG 4.5:1 in both. Each page's `<head>` has
  the early snippet that sets a saved dark theme before anything draws, plus `/theme.js`. Check new
  screens in both themes.
- Every league name shows `leagueIcon(cfg)`: the league's picture (`cfg.pic`: Sleeper's league avatar,
  or your team's logo in an ESPN league, kept through `slimLeague`) with a lettered site badge in the
  corner (not the sites' logos), or a plain football when there's no picture. Give Yahoo a `pic` too.
- Screens have addresses under `/app/` (`SLUG` in `app.js`; `firebase.json` rewrites `/app/**` to
  the app page, and the UI test's server does the same). A new screen needs a slug.
- The demo (`DEMO` in `app.js`) uses its own storage names and never loads `sync.js`, so it can't
  overwrite a real account or reach Firestore. Keep new storage, sync and server calls behind it.
- When a refresh's saved data gains a field the screens rely on, bump the snapshot version
  (`v` in `collect`, `sleeper.js`) and the matching check at the end of `app.js`, so devices
  holding an older snapshot refresh on open instead of showing gaps.
- Live scores refresh without a full refresh (`livePoints`, `loadMatchups`, `scheduleLive`):
  keep them light. ESPN's box score is ~230 KB, so it's fetched every other tick.
- The Results tab's internal id is still `score`; only its label changed.
- Folding (Lineups, Rosters, Matchup) goes through `isOpen`, `setFold` and `foldAll` in
  `app.js`, keyed by `FOLD_KEY`. Only a person's tap on a header is saved (`tapped`); code
  that opens or closes a league (the Rosters search, jump chips) must not save it.
- A new rankings format: study the person's file locally, then test with a few made-up rows in
  the same format (see The Hall's test in `tests/engine.test.js`). Never commit a ranking
  site's actual file; many are paid. Name known sources in `parseRanks`'s `source`.
- Titan's lineup is `optimal` (who starts, by rank) then `flexLate` (latest kickoffs in the flex
  spots); `spotMoves` turns it into the changes shown. Route new lineup logic through them, and
  never move a locked player.
- Default rankings (`defaultRanks`, `rankingsBy` in `engine.js`) are Sleeper's weekly projections
  in each league's scoring. A week's import wins; the defaults fill positions it leaves out, or
  everything when nothing is imported. The app (`ranksFor`, `analyze`, Results, `keepStarted`)
  and the server job (`freezeForUser`) follow the same rule: change them together.
- Rosters follow Sleeper's order: `L.rows` for starters, then the bench by `POS_ORDER`,
  then Reserve (IR and taxi, `heldAs`). Keep new roster views in that order.
- Show new ESPN or Yahoo features in the app and the Play listing only once they work (Google treats
  promised features in a listing as misleading). The website says Yahoo is coming soon, at the
  owner's request (2026-09-11): its title, a Yahoo card and the FAQ. Keep that wording honest until
  Yahoo leagues work.

## Writing (app text, README, store listing)

Follow `D:\Claude\00_Resources\voice-principles.md`. Plain and conversational, no em dashes, and
none of: dive into, game-changing, straightforward, leverage, synergize, circle back, touch base.

## Testing

```
node tests/run.js                 # everything; tests that need an account skip without one
node tests/run.js engine espn     # just these
```

PowerShell: `$env:TITAN_SLEEPER_USER = '<username>'` first to include the live account, the
Sleeper half of the UI test, and the mixed Sleeper and ESPN refresh. The first run downloads
Sleeper's and ESPN's public player lists into `tests/.cache/`. `functions.test.js` needs
`npm install` in `functions/` once. `ui.test.js` needs Chrome (set `CHROME` for another path).
Tests that use private data live outside the repo in `D:\Claude\titan-private-tests`.

## Deploying and save points

```
firebase deploy --only hosting
firebase deploy --only functions
firebase deploy --only "firestore:rules,firestore:indexes"
```

Google Cloud also runs two things outside this repo: daily Firestore backups kept 7 days (restore
into a new database from the console or `gcloud firestore databases restore`), and an alert policy,
"Titan server problems", that emails the owner when a function logs an error or the game-day job
can't check someone (at most hourly). Keep the service names in its filter when adding functions.

Test, commit, push, then deploy. After a deploy, check the live files, and for the server job
trigger a run and read its logs. A save point is an annotated tag `vX.Y.Z`, a row in README's
Save points table, and `git archive` of the tag into `D:\Claude\backups`.

## Windows notes

- Windows PowerShell 5.1: a commit message in a here-string must not contain double quotes; they
  split git's arguments and the commit fails.
- Scripts that call `firebase`: reload `PATH` from the Machine and User values first.
- No `gcloud` here. For Cloud Scheduler and Cloud Logging, use firebase-tools' own login:
  `lib/auth.getGlobalDefaultAccount()`, `lib/requireAuth.requireAuth({user, tokens})`, then
  `lib/apiv2.Client`.
- Android builds (`titan-android`): clear `NoDefaultCurrentDirectoryInExePath` for the process,
  and stop the Gradle daemons (`D:\Apps\gradle-home`) before and after `bubblewrap build`.
