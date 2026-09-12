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
| `stats.js` | Visit counts (Cloudflare Web Analytics) for the website's pages only; see Rules |
| `demo.js` | "Try a demo" (`/app/?demo`): two sample leagues built from Sleeper's player list and this week's projections |
| `app/index.html` | The app's page, at `/app/`. It loads every file by absolute path (`/app.js`, `/styles.css`) |
| `engine.js` | All the rules, pure (runs in the browser, in Node tests and in the server job): rankings parsing, start/sit, waiver ideas, exposure, byes, projections, kickoff freezing, weekly scoring |
| `sleeper.js` | Sleeper API, the refresh (`collect`) for Sleeper and ESPN leagues, browser storage |
| `espn.js` | ESPN adapter: reads leagues, turns them into `buildLeague`'s shape, matches players to Sleeper ids |
| `app.js` | Screens and interactions |
| `sync.js` | Google sign-in, Firestore sync, the saved ESPN login, the private-ESPN transport, the Yahoo link (ES module) |
| `yahoo.js` | Yahoo Fantasy's nested answers read into Titan's shapes (being built; see Rules) |
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
- Navigation: five sections (`SECTIONS` in `app.js`): Lineups, Matchup, League (Standings, Rosters,
  Trade, Transactions), Players (Waivers, News, Exposure, Byes) and Rankings (Import, which is the `ranks`
  screen, and Results), with Settings behind the gear (`#gear`). Phones, the Android app and home-screen
  copies show them as a bar along the bottom (the header is solid there: a see-through `backdrop-filter`
  header would hold the fixed bar inside it); wide windows as a header menu whose sections drop down
  their screens. `screenBar` puts a section's screens as sub-tabs at the top of each screen, and the one
  league dropdown (`S.ui.league`: a league id or 'all'; `pickedLeague`, `inPick`) on the screens in
  `LEAGUE_SCREENS`; Standings and Trade follow it when it names a league and keep their own picker under
  All leagues. A section opens on the screen used there last (`S.ui.last`). Badges: lineup changes on
  Lineups, a dot on Players for waiver pickups not yet seen on Waivers (`newWire`; opening Waivers
  saves what's there as `S.ui.seenWire`, keyed by league and player). Every screen keeps a `data-tab` button in `#tabs` (the
  dropdowns) or the gear, which the UI test's `tab()` clicks. Screen ids and addresses didn't change.
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
  `watch` in their alerts doc; `newsAlerts` runs on every 15-minute run all week, reads the feed once (`newsForAlerts`: Titan's own
  `/api/news` first, ESPN directly only if that fails, since ESPN has turned the game-day job's server
  away while letting the News tab's in)
  and only looks at people when a new story tags a player (`SCC.newsAlertsFor`, at most 3 at a time,
  key `news|week|story|player`). A news alert's tap opens the story (sw.js).
- The scores ticker (`loadScores`, `paintTicker` in `app.js`): this week's NFL games from ESPN's
  public scoreboard through Titan's server (`nflScores` at `/api/scores`, one shared read kept 20
  seconds, CDN 20; `ESPN.scoreboardFrom` gives each side's points and the short status). It sits under
  the header, not in it, so the sticky header (and the wide screens' sticky league list below it) keep
  their place. It reads every 30 seconds while a game is live or kicks off within 10 minutes, every 10
  minutes otherwise, only while the page is in view, and never in the demo. Each game links to its
  ESPN page, "Scores: ESPN" credits the source, and a badge counts the person's starters in the game.
- FantasyCalc's arrangement with Titan (email from FantasyCalc, 2026-09-12): its values stay out of
  Titan's trade calculator for the public. Showing who wins, each team's value change in percent, and
  lines like "Your starters +988 · theirs +518" is fine. Free while Titan stays under about 10k
  sessions and $2k revenue a month (then revisit), with a credit on every page that uses its data and at
  least one link that doesn't depend on JavaScript (the app page's footer), and cached calls to the
  current-values endpoint only. Never suggest FantasyCalc approves of or partners with Titan. So only
  Titan's owner (`fcShown`, the `titanOwner` claim) sees FantasyCalc's numbers, position ranks and
  trends; everyone else sees Titan's own value (`SCC.titanValues`: projected season points above a
  replacement starter at the position, from Sleeper's season projections via
  `API.fetchSeasonProjections`, never derived from FantasyCalc), draft picks without a number, and
  the verdict as percent changes (`tradeDisplay`, `tradeSummary`). In a dynasty league they also get
  a note (`.tdyn`) that Titan's values are this season only, without age or future seasons.
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
  (`lineupPoints` with values, not one week's projections), at most two per partner. The ideas card
  is one line until Find trades, and Clear folds it back. "Who has him?" (`tradeSearchResults`)
  searches the league's rosters, then free agents; Trade for him sets the partner and the get side.
  Copy and open (`data-trade-copy`): copies "Trade offer: my X for your Y" and opens `lineupUrl`.
  Sleeper can't be pre-filled: its API is read-only, and its web trade page (`/beta/leagues/:id/trade`,
  checked 2026-09-11) takes only the league and sits behind flags that are off. Never ask for Sleeper logins.
- Game context on Lineups rows (`SCC.gameTags`) comes from the `gameContext` function at
  `/api/game-context` (kept 30 minutes): ESPN's scoreboard lines (`ESPN.scoreboardFrom`,
  `SCC.impliedTotals`), NWS forecasts at kickoff for outdoor US games (`STADIUMS` holds each home
  stadium's spot; NWS needs a User-Agent), and points allowed by position (`SCC.dvpFrom` over
  nflverse's `stats_player_week_<season>.csv.gz`, CC BY 4.0, credited on Lineups; last season's
  until three weeks are played; Firestore `meta/dvp`, 12 hours).
- The Transactions tab (tab id `moves`, address `/app/transactions`): each Sleeper league's last three
  weeks of completed transactions (`API.leagueTransactions` → `SCC.transactionsFrom`), reloaded every
  five minutes while the tab is open. A league picker (`S.ui.movesLeague`, remembered) narrows the list; the kind chips'
  counts follow it. ESPN transactions aren't read yet (their format hasn't been checked on a real league).
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
- Yahoo is being built, and only Titan's owner can use it until it works end to end (`YAHOO_OPEN` in
  `functions/index.js`, and `yahooLink` in `app.js`). People link their own Yahoo account (OAuth 2.0,
  confidential client, Fantasy Sports read): `yahooStart` makes a one-time state (`yahooStates/{state}`,
  ten minutes), Yahoo returns to `/api/yahoo/callback` (`yahooCallback`), and the tokens go to
  `yahooTokens/{uid}`, outside `users/{uid}`, so no browser can read them. Every Yahoo read goes
  through the server; `yahooAccess` refreshes and saves Yahoo's rotated refresh token at once. The
  secret is `YAHOO_CLIENT_SECRET` in Secret Manager: never in the repo. `yahoo.js` reads Yahoo's
  nested JSON (`flat`, `list`, `details`, `subs`) and builds leagues (`leagueCfg`, `buildLeague`,
  players matched by `SCC.playerIndex`/`matchPlayer`, shared with ESPN). Each refresh reads every
  Yahoo league through the server (`yahooLeague` kind `all` → `yahooAll`; `YAHOO.fetchAll` in
  `collect`) when `account.yahoo.linked` is set and sync.js has set the transport. Yahoo leagues show
  on Lineups, Rosters, Exposure, Byes and Waivers; Matchup, Standings, Trade and Results say they're
  coming next, and live points wait too. Sleeper's own leagues carry no `platform`: test with
  `isSleeper` (sleeper.js) or `onSleeper` (app.js), never `!== 'espn'`. Yahoo's terms: keep Yahoo user
  data at most 24 hours (re-read it; the app drops Yahoo leagues from a saved refresh over a day old,
  and the server job never reads Yahoo), credit "Fantasy data provided by Yahoo Fantasy" wherever it
  shows (`yahooCredit`), and hide the tip jar for anyone who links Yahoo (`tipJar`, and `titan.noTip`
  for the website's pages in theme.js; the owner's call). Titan's access request is
  with Yahoo (received 2026-09-11). Before opening it to everyone: Yahoo's approval, the privacy and
  terms pages, the Play listing, and the website's coming-soon wording.
- Team names: every fantasy team, on every tab and both platforms, reads "Nickname (account name)"
  from `SCC.teamLabel` (Sleeper's `team_name` and `display_name`; ESPN's team name and member name),
  or the account name alone when there's no nickname. Build new team names with it, and don't add
  the manager again where one is shown. `slimSchedule` keeps the members so private ESPN leagues get them.
- The Ko-fi tip jar sits at the bottom of every page, never the header: the app's footer (`data-tip`),
  the website's footers (home and guides), and the end of privacy and terms. It hides inside the Play
  app (the app's `IN_PLAY_APP` in `tipJar`; `theme.js` on the website's pages, from `titan.play`,
  `?source=play` or the android-app referrer) and for anyone who links Yahoo (`titan.noTip`). A new
  website page ends with it too.
- Visit counts: Cloudflare Web Analytics, loaded by `stats.js` on the website's pages only (home,
  guides, privacy, terms; a new website page gets the tag too, and `tests/stats.test.js` checks).
  `counts` keeps it off `/app/`, the Play app (`?source=play`, the android-app referrer, `titan.play`),
  home-screen copies and any host but titanfantasyfootball.com. Never load it in the app: the Play
  Data safety form declares no analytics, and the privacy policy says the app has none. `TOKEN` is public.

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
