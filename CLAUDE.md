# Titan Fantasy Football Manager: working notes for Claude

A static web app (no build step, no dependencies) plus two Firebase Cloud Functions. Live at
https://titanfantasyfootball.com (Porkbun domain on Firebase Hosting; also served, and kept, at
https://titan-fantasy-football.web.app, where the first Android test build pointed; never redirect it.
The Android app opens titanfantasyfootball.com/app/?source=play since the v1.11.0 build)
(Firebase project `titan-fantasy-football`, Blaze plan);
code at github.com/clintonburnell-cmd/titan-fantasy-football. The Google Play app is a Trusted Web
Activity kept outside this repo (`D:\Claude\titan-android`, with `PLAY-LISTING.md`); it loads the
live site, so site changes reach it without a new upload. What's done lives in `README.md`
(Screens, Save points); where things stand and what's next, in the private `RESUME.md`.

## Start here

- **Resuming?** Read `RESUME.md` first: where things stand, the latest save point, what's next and the owner's
  to-dos. It's private: gitignored, and on `firebase.json`'s ignore list so it's never deployed. Bring it up to date
  at the end of a session.
- The rules are grouped by area: Never first, then code and data, navigation and look, the screens, Trade and
  FantasyCalc, the owner's screens, the server, Yahoo, and the website and Android app.
- The loop for any change: test, commit, push, deploy, check the live site, send the owner a push notification,
  then make a save point (Deploying and save points, below).

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
| `functions/index.js` | `freezeCalls` (every 15 minutes on game days), `espnLeague` and `espnLogin` (private ESPN leagues and the saved login), `deleteMyAccount`, the `/api` feeds |
| `tests/` | `node tests/run.js` |

## Never

The rules that hold whatever the task.

- **Never write the owner's personal Sleeper username or Sleeper user ID into this repo**, a commit
  message, a screenshot or the Play listing. Tests read a real account from the
  `TITAN_SLEEPER_USER` environment variable. Before every commit, `git grep -i` for the username
  and ID (they're in Claude's memory; ask the owner if not).
- Never commit paid rankings (Late-Round exports) or anything from `titan-android`'s keystore and
  password files. Test rankings come from `tests/fixtures/sample-rankings.csv`.
- Tests must never read a real person's ESPN league: serve ESPN requests with `stubEspn` or
  Chrome's request interception, as the existing tests do.
- Never put a credential where a browser can read it. A saved ESPN login (`espn_s2`) lives in
  `espnCreds/{uid}` and Yahoo's tokens in `yahooTokens/{uid}`: top-level collections with no rule, so
  only the server reaches them. `users/{uid}/...` is readable by that person's browser, so nothing
  secret goes there (private/espn holds only the SWID and when). Never ask for Sleeper logins.
- Never store the owner's Sleeper login to act for him (asked 2026-09-15; declined: Sleeper has no
  write API, its terms allow suspension for automated means in prize contests, a stored password is a target).
- Show new ESPN or Yahoo features in the app and the Play listing only once they work (Google treats
  promised features in a listing as misleading). The website says Yahoo is coming soon, at the
  owner's request (2026-09-11): its title, a Yahoo card and the FAQ. Keep that wording honest until
  Yahoo leagues work.

## Code and data

How the pieces fit, and what keeps them working.

- Keep `engine.js` free of page and network code.
- A change to `engine.js`, `espn.js` or `sleeper.js` needs the functions redeployed too: the
  predeploy step copies them into `functions/shared/`.
- Adding a file the app loads: add it to `SHELL` in `sw.js` and bump `CACHE`. The service worker serves
  scripts, styles, fonts and images from the saved copy at once and refreshes it in the background
  (stale-while-revalidate); pages go to the network but fall back to the saved copy after `PAGE_WAIT`
  (2.5 s). So a deployed change reaches a device on its second open, not its first.
- Scoring (`SCC.trimProjections`, `projFor`, `scoringDeltas`): a projection is `[standard points, receptions,
  stat line]` and a league's points are standard + `cfg.ppr` × receptions + Σ `cfg.scoring[k]` × stat[k], where
  `cfg.scoring` is the league's differences from Sleeper's standard (`SLEEPER_STD`, verified against pts_std
  2026-09-15) over the stats Sleeper projects (`PROJECTED`). Standard and PPR leagues come out exactly as
  Sleeper's numbers; 6-point passing TDs, TE premium (`bonus_rec_te`, which Sleeper projects as the tight
  end's catches), first downs, bonuses and ESPN's -2 interceptions count where a league scores them.
  Sleeper leagues get `scoring` from `scoring_settings`; ESPN leagues from `scoringOf` (stat ids mapped, a
  per-position `pointsOverrides` on receptions becoming `bonus_rec_*`); Yahoo has none yet. Pass the league
  (`cfg`) to `projFor`/`defaultRanks`, not `cfg.ppr`: a number still works but drops the rest. The week's
  record (`freezeWeek`) carries each league's `scoring`; `rankingsBy` builds one map per distinct scoring;
  `describeLeague` names 6-pt pass TDs and TE premium (`scoringNotes`). Cached projections are v2 keys.
- `render()` repaints in place (`paint` → `morph`: attributes and text set only where they differ,
  children paired by position or by id), so focus, sideways scroll, open menus and decoded photos
  survive the live tick. Consequences: never rely on a repaint resetting a field or a scroll
  position; a field being typed in keeps its value; give a list item an `id` if its position can
  change. `paintAccount` rebuilds `#acct` only when its HTML changed.
- Storage: `saveSnap` writes the refresh (`KEY.snap`) on every full refresh and at most every five
  minutes from the live tick, and tells the person once when storage is full (`STORAGE_FULL`).
  `pruneStorage` drops projection and kickoff keys for other seasons and weeks well past. A combined
  week keeps its sources' rows only for the last three weeks. Coming back to the app after five
  minutes does the cheap update (`API.livePoints`); a full refresh waits for half an hour (`FULL_STALE`).
- Screens have addresses under `/app/` (`SLUG` in `app.js`; `firebase.json` rewrites `/app/**` to
  the app page, and the UI test's server does the same). A new screen needs a slug.
- The demo (`DEMO` in `app.js`) uses its own storage names and never loads `sync.js`, so it can't
  overwrite a real account or reach Firestore. Keep new storage, sync and server calls behind it.
- When a refresh's saved data gains a field the screens rely on, bump the snapshot version
  (`v` in `collect`, `sleeper.js`) and the matching check at the end of `app.js`, so devices
  holding an older snapshot refresh on open instead of showing gaps.
- Live scores refresh without a full refresh (`livePoints`, `loadMatchups`, `scheduleLive`):
  keep them light. ESPN's box score is ~230 KB, so it's fetched every other tick.
- Titan's lineup is `optimal` (who starts, by rank) then `flexLate` (latest kickoffs in the flex
  spots); `spotMoves` turns it into the changes shown. Route new lineup logic through them, and
  never move a locked player.
- Default rankings (`defaultRanks`, `rankingsBy` in `engine.js`) are Sleeper's weekly projections
  in each league's scoring. A week's import wins; the defaults fill positions it leaves out, or
  everything when nothing is imported. The app (`ranksFor`, `analyze`, Results, `keepStarted`)
  and the server job (`freezeForUser`) follow the same rule: change them together.
- Rosters follow Sleeper's order: `L.rows` for starters, then the bench by `POS_ORDER`,
  then Reserve (IR and taxi, `heldAs`). Keep new roster views in that order.
- Team names: every fantasy team, on every tab and both platforms, reads "Nickname (account name)"
  from `SCC.teamLabel` (Sleeper's `team_name` and `display_name`; ESPN's team name and member name),
  or the account name alone when there's no nickname. Build new team names with it, and don't add
  the manager again where one is shown. `slimSchedule` keeps the members so private ESPN leagues get them.
- Folding (Lineups, Rosters, Matchup) goes through `isOpen`, `setFold` and `foldAll` in
  `app.js`, keyed by `FOLD_KEY`. Only a person's tap on a header is saved (`tapped`); code
  that opens or closes a league (the Rosters search, jump chips) must not save it.

## Navigation, look and type

- Navigation: six sections (`SECTIONS` in `app.js`): Lineups, Matchup, League (Standings, Rosters,
  Trade, Transactions), Players (Waivers, News, Exposure, Byes) and Rankings (Import, which is the `ranks`
  screen, Import multiple, which is `multi` at `/app/multiple`, and for Titan's owner only Compare (`lab`) and Value
  report (`value`), the screens in `OWNER_TABS`) and Results (the `score` screen), with Settings behind the gear (`#gear`). Phones, the Android app and home-screen
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
- Two themes: white and blue by default, and dark (`theme.js` sets `data-theme="dark"` on `<html>`,
  remembered in localStorage `titan.theme`; a moon/sun button in the headers, and Appearance in
  Settings). Every colour that differs between them is a token in both `:root` blocks of `styles.css`
  (no raw colours for text or surfaces), and text meets WCAG 4.5:1 in both. Each page's `<head>` has
  the early snippet that sets a saved dark theme before anything draws, plus `/theme.js`. Check new
  screens in both themes.
- Every league name shows `leagueIcon(cfg)`: the league's picture (`cfg.pic`: Sleeper's league avatar,
  or your team's logo in an ESPN league, kept through `slimLeague`) with a lettered site badge in the
  corner (not the sites' logos), or the Titan icon (`/icon.svg`, `NO_PIC`) when there's no picture. Give Yahoo a `pic` too.
  On Matchup, your score in the middle is red when you're behind, or purple (`--fav`) while you're behind but
  still projected to win (over a 50% chance); the status line says so in words too.
- Type: the app (`body.app-page`; the website keeps the system font) uses Inter (`fonts/inter-latin-wght.woff2`, fontsource's Latin variable build, SIL Open Font
  License in `fonts/OFL.txt`; keep the license beside it). Titan serves it itself, so no browser asks Google or anyone
  else for it: never switch to a font CDN (the privacy policy and Play's Data safety form say the app shares nothing).
  It's in `SHELL` in `sw.js`. Its type scale sits on `.vr-page` (`display: contents`, so the main view's grid gap still
  spaces the sections): four sizes (12, 14, 17 and 26px, tables 13px on phones) and three weights (400, 600, 700), same-
  width numbers only in tables and tile numbers (Inter's tabular setting widens hyphens in running text), small
  uppercase table headers. App-wide (v1.28.0): Inter for all text, weights capped at 700 by the `@font-face` range (the
  stylesheet's 800s and 900s draw at 700), report-style headers on the data tables (`.rtable`, `.stand`, `.pstr`,
  `.season-t`), and `font-size-adjust: 0.5` on `body.app-page` (Inter's x-height is 0.546 of its size, Segoe UI's 0.5:
  drawn at Segoe UI's, the phone layouts keep the room they were fitted for; `.vr-page` opts out). Each screen keeps its
  own tuned sizes. Inter's same-width setting (`tabular-nums`) also changes the space, hyphen, colon, period, comma and
  brackets, so set it on number cells, not on blocks with words; where a block is set same-width, its words go back to
  normal (`body.app-page :is(...)` in styles.css). Standings sets it on `.tnum` cells only. For any change to the app's look, run the UI test with `TITAN_SHOTS` before and after: its screen
  tour photographs all 14 screens at 390px and 1280px (`tour-<width>-<screen>.png`) to compare.

## Screens

One note per screen or feature.

- The league dropdown (`LEAGUE_SCREENS`) steers Lineups, Matchup, Standings, Rosters, Trade,
  Transactions, Byes, Value and Data dump. Standings and Trade show one league at a time: under All
  leagues the first league shows with a line naming it (`onePick`); there is no second picker. On a
  screen that always shows every league (Waivers, Results, Exposure, News) the dropdown's place says
  "All leagues" (`.lpick-off`) while a league is picked, so the filter never seems to vanish.
- Results (`loadScore`): a week that hasn't kicked off leaves the week that was showing in place with a
  note; the forward arrow to this week opens only once a game has started (`weekStarted`); a failure
  is retried when the screen is reopened a minute later (`errorAt`). Matchup's "projected final" once
  games start is `winProbability`'s expected total (`matchState`), the number the win chance rests on.
- Dialogs (`openPlayerCard`, `openDraftResults`) return focus to what opened them (`pcOpener`,
  `dlgOpener`). The player searches share `indexOf(players)` (names normalised once per player list)
  through `searchPlayers`.
- Lineups' league cards (`leagueCard`): the changes to make, then the recommended lineup (`recLineup`: the engine's
  `L.opt` when there are moves, else the lineup as set, so it never shows a change the steps don't; `recRow`, NEW where
  it differs) and yours beside it (`compareLineups`, table `.lu-cmp`, the differing spots highlighted, your players'
  verdicts on your side; one line when they match). Tests count `.lineup .row`, which is the recommended list.
- Lineups' week dropdown (`screenBar`, `select[data-ui="lineWeek"]`, `S.look`, not remembered): this week, then
  every week to 18 (`LAST_WEEK`). A later week is a plan: `SCC.planWeek` (pure, tested) copies the snapshot with
  that week's game days and opponents from Sleeper's schedule (`API.nflSchedule`), nothing locked or scored, and
  only lasting injury tags (IR, PUP, Sus, NA, DNR) benching; `lookAnalysis` runs it through `ranksFor` with that
  week's projections, so rankings imported for that week win. `S.A` stays this week's (nav dot, Waivers, alerts).
  While a later week draws, `LV` holds it and `kickText`, `teamKick`, `projOf` and `ctxLine` read it; game lines,
  weather, live notes and the game tiles are this week's only.
- Matchup: where you stand, in words, comes from `SCC.matchStatus` (pure, tested) through `matchState`
  in `app.js`, which the card and the summary at the top share; the summary's filters are
  `MATCH_KINDS` (`S.ui.matchFilter`, chips `data-mfilter`). Opened, the scoreboard (`.board`) shows the
  score, so the header's score row hides.
- The Standings tab (`SCC.standings`): records, all-play, luck, power and playoff odds from 5,000
  seeded simulations; schedules from `API.leagueSchedule` (Sleeper matchups, or ESPN via
  `ESPN.fetchSchedule`; private ESPN leagues through `espnLeague` kind `schedule`).
- Position strength (`SCC.positionStrength`, pure and tested): each team's best lineup this season
  by Sleeper's season projections (never FantasyCalc's, so everyone sees it), starters added up by
  position plus a quarter of the best bench player there, ranked across the league; top third 'deep',
  bottom third 'thin'. Standings shows every team's ranks (`strengthTable`, table `.pstr`, not
  `.stand`, which the UI test counts); the Trade tab shows the partner and you once a partner is
  picked (`tradeFit`, "Where you both stand", with the good fits). Both load the season projections.
- The Transactions tab (tab id `moves`, address `/app/transactions`): each Sleeper league's last three
  weeks of completed transactions (`API.leagueTransactions` → `SCC.transactionsFrom`), reloaded every
  five minutes while the tab is open. A league picker (`S.ui.movesLeague`, remembered) narrows the list; the kind chips'
  counts follow it. ESPN transactions aren't read yet (their format hasn't been checked on a real league).
- The Waivers tab: the waiver plan (`planCard`, from `SCC.waiverPlan`, pure and tested: claims from the
  rankings' wire targets `L.wire`, at most three a league, and a drop for each: the bench player with the
  lowest season value (`planValue`: Titan's value, then season projected points, so a star on bye is
  safe) that isn't on IR or the only bench player at a position the lineup starts; a dropdown swaps him;
  Done and changed drops are `S.ui.wplan`, started over each week; `cfg.bench` counts open roster spots),
  free backups (`SCC.backupOf`), Sleeper's
  trending adds (`API.trendingAdds`) with where each is free (`L.takenNorm`), a search, and bids
  (`SCC.faabBid` from `API.leagueWaivers`: a Sleeper league's last six weeks of winning bids). Each pickup
  shows a usage line (`usageLine`, `SCC.usageOf` over the last three finished weeks of `API.fetchStats`).
- The player card (`openPlayerCard`): any element with `data-pcard` (`pcAttr`, players with a Sleeper id)
  opens a `<dialog>` with the player's last four games and season from `API.fetchPlayerStats` (Sleeper's
  per-player stats, `grouping=week`; `trimStat` in sleeper.js keeps what Titan shows). Back closes it, like
  the draft results. Snap counts reach Sleeper's stats some time after a game, so the card hides them until
  then. The UI test builds the demo a week ahead (it moves Sleeper's `/state/nfl` on one) so the plan has claims
  on game days too.
- Draft results (the Trade tab's See the draft, `openDraftResults` in `app.js`): a `<dialog>` outside
  `#view`, repainted only when its HTML changes (`paintDraftResults`, so an open team and the scroll
  survive redraws) and closed by Back (opening pushes a history entry; `popstate` closes it). Drafts
  come from `API.leagueDraft`: Sleeper's `/league/:id/drafts` then `/draft/:id/picks`
  (`SCC.draftFromSleeper`); ESPN's `ESPN.fetchDraft`, `view=mDraftDetail` plus ESPN's player list
  filtered to the drafted ids (the draft gives ids only), private leagues through `espnLeague` kind
  `draft`. ESPN defenses have negative player ids; only -1 is an empty pick. `SCC.draftGrades` weighs
  each pick against its spot by the value the Trade tab shows (FantasyCalc's only for the owner).
  When most picks have no Titan value (a dynasty rookie draft), everyone but the owner sees the board
  ungraded (`plain`).
- The Results tab's internal id is still `score`; only its label changed. It's its own section now. Won or
  lost comes from `scoreLeague` (the other team in the same matchup; ESPN's opponent from the box score,
  `espnWeek`), the bench's misses from `SCC.benchMistakes`, both pure and tested. Season so far scores
  the earlier weeks one at a time (`loadSeason`, through `scoreFor`) and keeps each finished week on
  the device (`KEY.season`, tied to the leagues and that week's rankings). Its chart's columns use
  `--chart-bar`, checked with the dataviz palette checks in both themes; a table sits behind it.
- Import multiple sources (`screenMulti`): `SCC.combineRanks` (pure, tested) combines each position on
  its own (a source missing a player counts him one below its last there, weights 1x to 3x) and fits RB,
  WR and TE onto one FLEX list from the sources that have an overall list (`opts.curve`, Titan's default
  rankings, when none does). The result is saved as the week's `rows`, so every call, the server job
  and Results read it unchanged; the sources ride along as the week's `multi` (synced with it), and an
  unsaved set stays on the device (`KEY.multi`). A plain import over that week drops `multi`.
- A new rankings format: study the person's file locally, then test with a few made-up rows in
  the same format (see The Hall's test in `tests/engine.test.js`). Never commit a ranking
  site's actual file; many are paid. Name known sources in `parseRanks`'s `source`.

## Trade and FantasyCalc

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
  a note (`.tdyn`) that Titan's values are this season only, without age or future seasons. Both
  rosters sort by value, position, or position then value (`TRADE_SORTS`, `S.ui.tradeSort`, position
  headers when grouped), and every player shows the colored position tag (`pos()`). The partner's
  roster card is headed by a second partner picker (`.tp-select`, same `data-ui="tradePartner"`), and
  Clear all (`trade-reset`) empties the trade, the partner, the league's trade ideas and the search.
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
  is one line until Find trades, and Clear folds it back. The edge (v1.39.0, the owner's ask for "an edge in statistical
  trades"): the market's values alone can't find one (every fair trade is one the market calls even), so the Trade tab
  reads the numbers behind the market. For the owner, the Value report's rows for the league's format (`valueRowsFor`,
  `S.value.rows`, loaded on the Trade tab too) give each player's usage edge (`edgeFor`: `SCC.impliedValue` from the
  row's `vgap` against FantasyCalc's price, minus that price), a buy/sell/keep tag and a momentum note on the roster
  rows (`valueTag`: a rising price on touchdown-driven points, `td`, is one to sell into), and the summary's edge line
  (`edgeLine`, `.tedge`). Everyone else's edge line is Titan's own values summed (no FantasyCalc numbers). Trade ideas
  take `edge` (the owner's own gain is measured by market value plus edge, the partner's by market value, so a swap of
  equally priced players the market misjudges is an idea), `points` (rest-of-season points, `spanFor`/`SCC.spanPoints`
  from the season projections with byes out; an idea may not lower them) and `thin` (positionStrength), and each
  carries `accept` and `why` (fills their hole, they get the best player, asks two starters for one; ±15% a point on
  the order). The impact table (`lineupImpact`, `.tl-t`) shows this week, the rest of the regular season (`LAST_REG_WEEK`
  17) and the playoff weeks (`cfg.playoffStart` or 15, three weeks; for the owner tilted up to 10% by the Data dump's
  playoff schedule rank, `playoffTilt`). Batch B (v1.40.0): ideas allow two for two; in a dynasty or keeper league each
  team's stance from the standings simulation (`stanceOf`: contender at 55% playoff odds, rebuilder at 25%;
  `standingsResult` is shared with Standings) puts draft picks into the ideas for rebuilding partners (and from
  contenders when you're rebuilding) and a line on "Where you both stand" (`stanceLine`) says what to offer; "to even
  it out" leans toward a position the receiving side is thin at; a bye check (`byeCheck`, `SCC.byeNeeds`) warns when
  the trade leaves a week with an empty starting spot, or notes one it clears; Titan's own values are for the rest of
  the season (`titanValues` opts `from`/`to`, byes out), read between the two players either side of the replacement
  spot, with the flex shares from how the league's teams fill them (`SCC.flexShares`) once its teams are loaded.
  "Who has him?" (`tradeSearchResults`)
  searches every league: each league's teams load for it (`loadTradeTeams(d, true)`, which redraws only the results so
  the box keeps its cursor), and every league gets a chip: the team that has him, yours, or free agent (a league not
  loaded yet, or Yahoo, falls back to the snapshot's `takenNorm`: free or taken). Tapping another team's chip
  (`data-tsearch` league|team|player) moves the Trade tab to that league with that team as partner, him on the get side.
  Copy and open (`data-trade-copy`): copies "Trade offer: my X for your Y" and opens `lineupUrl`.
  A Sleeper league's team page (`lineupUrl`, from `SCC.sleeperTeamUrl`) is an Android intent on Android
  (`IS_ANDROID`): the Sleeper app (`com.sleeperbot`) first, the web page as `browser_fallback_url`; an intent link
  opens in place, without `target="_blank"` (`newTab`). Sleeper's iPhone app takes only chat links (topics, channels,
  messages in its apple-app-site-association, checked 2026-09-15), so iPhones get the web page. Never store the
  owner's Sleeper login to act for him (asked 2026-09-15; declined: no write API, Sleeper's terms, credential risk).
  Sleeper can't be pre-filled: its API is read-only, and its web trade page (`/beta/leagues/:id/trade`,
  checked 2026-09-11) takes only the league and sits behind flags that are off. Never ask for Sleeper logins.

## Titan's owner

The owner's account (the `titanOwner` claim) and the screens only it sees.

- Titan's owner is the one sign-in account with the `titanOwner` custom claim. `ownerStats`
  refuses everyone else and returns totals only: never add per-person details to it.
- Compare rankings (`screenLab`, tab `lab`, `/app/compare`) is Titan's owner's only: its sub-tab and menu
  button show only with the `titanOwner` claim. The server's `run` saves FantasyCalc's values once a week
  (`labSnapshot` → `lab/{season}-{week}`, every format in `lab/config` plus any cached in `tradeValues`;
  `late` when saved after the week's first kickoff, and a late week doesn't count for FantasyCalc). The
  owner's app keeps `lab/config` (`sendLabFormats`, keys like `redraft-1qb-12teams-1ppr`, matching
  `valuesKey`). Only the owner can read `lab/` and write `lab/config` (firestore.rules). `SCC.labWeek`
  (pure, tested) scores lineup points (scoreLeague's by-rank per source) and order (rank correlation
  against Sleeper's stats feed, `API.fetchStats`, PPR). Finished weeks are kept on the device (`KEY.lab`).
- Data dump (`screenDump`, tab `dump`, `/app/data-dump`, right after Value under Rankings) is Titan's owner's only too,
  and separate from Value. Each Tuesday the owner downloads a spreadsheet (`week<N>-data-dump.xlsx`: player usage and
  expected points, defense by position, schedule strength, team tendencies) to Downloads; on the owner's PC the
  "Titan data dump" Windows task (hourly and at sign-in) runs titan-analytics' `run-dump.ps1`, which posts each new file
  once: `data_dump.py` turns it into ideas per Sleeper league (start, pick up, buy, sell, playoff schedule) and
  league-wide lists, and `upload.js dump` writes `lab/dump-latest` (only the owner can read `lab/`). The app reads it
  with `S.sync.api.dumpReport` (`loadDump`). It reuses the value report's look (`.vr-page`), search and position chips
  (`applyValueFilter`, `S.value.q`) and follows the league dropdown (Where column). The file and its numbers are the
  owner's and private: never in this repo, `public/`, the Waiver Wire or any screen but this one. Its payload shape is
  set by `data_dump.py` (version 1): change both together.
- Value report (`screenValue`, tab `value`, `/app/value`) is Titan's owner's only, like Compare. It's made outside this
  repo, on the owner's PC: `D:\Claude\titan-analytics` (Python, nflverse's usage-based expected points against
  FantasyCalc's values, buy-lows, sell-highs and claims per Sleeper league) runs every Tuesday at 7 AM and its
  `upload.js` writes the report as a JSON string to `lab/value-latest` (and `lab/value-<season>-<week>`) through
  Firestore's REST API with firebase-tools' login. The app reads it with `S.sync.api.valueReport` (`loadValue`);
  only the owner can read `lab/`. The report's shape is set by titan-analytics' `fantasy_report.py` (`payload`):
  change both together (version 2: every format's lists under `formats`, `main` the format most leagues play, and
  each league's `fmt` and who has each valued player there, `own`; version 1 reports still show). It follows the league
  dropdown (`value` is in `LEAGUE_SCREENS`): a league picked there shows only its moves, the lists in its own format and
  a Where column (Yours, the team, or Free agent); under All leagues, format chips (`S.ui.valueFmt`) pick the lists and
  put that format's leagues first. A player search (`data-value-search`, `S.value.q`) and the position chips filter
  the moves and tables in place (`applyValueFilter`, which `render` re-applies). The sell-high lists are "Sell high or
  keep" (the owner's name for them, 2026-09-15): every sell-high row and move carries a verdict (`keep` on rows, `k` on
  moves; `callPill`, `moveTag`), keep (`.p-swap`) when the role is a real starter's or the points come from yards on a
  proven skill, sell otherwise; the Data dump's ideas and tables use the same tags, and a schedule-only sell lean has
  no verdict. The weighting lives in titan-analytics (its README, "How the numbers are made"); Titan only shows it. Each table sits in a box that scrolls
  sideways (`.vr-scroll`) with the player column pinned; its header row follows the page down to the table's end
  (`pinValueHeads` moves it on scroll: sticky can't follow the page out of a box that scrolls sideways). Never add
  FantasyCalc's numbers to anything someone other than the owner can see.

## Server, ESPN and alerts

- Firestore (`firestore.rules`, explicit per path, nothing wildcarded): a person reads and writes
  `users/{uid}` (keys `account`, `alertsOn`, `lastSeen` only), `ranks/{week}` and `private/alerts`;
  reads `history/{week}` (the job writes it) and `private/espn` (the server writes it). `lab/` is the
  owner's, `public/` is world-readable and server-written, everything else (`espnCreds`, `yahooTokens`,
  `yahooStates`, `tradeValues`, `meta`) is the server's alone. `firestore.indexes.json` exempts the big
  fields (rows, values, formats, tokens...) from automatic indexing: a document over 40,000 index
  entries is refused, so exempt any new large map or array field.
- The user document mirrors two things the job queries on: `alertsOn` (the app sets it when alerts go on
  or off; `deliver` clears it when the last device dies) and `lastSeen` (each sign-in's `reconcile`).
  Backfilled for existing accounts on 2026-09-15. On non-game days `run` reads only `alertsOn == true`;
  on game days it skips accounts unseen for 45 days unless alerts are on (`DORMANT_AFTER`).
- `run` works through people eight at a time (`USERS_AT_ONCE`, `Promise.allSettled`) inside a 450-second
  budget (`JOB_BUDGET`, the function's limit is 540), and logs an error containing "could not" naming
  how many were left. Every outside read on the server has a timeout (`timeout()` in index.js,
  `fetchT` in espn.js, `fetchOpts` in sleeper.js). The week's record is written only when it changed.
  Each person gets at most `MAX_ALERTS_AT_ONCE` alerts per run and at most `MAX_ESPN_LEAGUES` ESPN
  leagues read (`espnLeaguesOf` validates ids).
- The ESPN login: `espnLogin` (callable) validates and saves it to `espnCreds/{uid}` and notes
  `{swid, savedAt}` in `private/espn`; `espnCredsFor` reads it back for the job and `espnLeague`, and
  moves a login saved the old way (pre-2026-09-15, in `private/espn` with `s2`) on first read; the
  client also sends one over at sign-in. Account deletion is `deleteMyAccount` (callable): recursive
  delete of `users/{uid}`, then `espnCreds`, `yahooTokens`, `yahooStates where uid`, then the Auth
  user; it wants a sign-in within five minutes (`recent-login`), and the client re-authenticates and retries.
- The public `/api` addresses take plain GETs with known parameters only (`plainGet`): a made-up
  parameter would skip the CDN cache and reach the function every time.
- Hosting sends security headers on every response (`firebase.json`: nosniff, frame denial, referrer
  policy, permissions policy, HSTS). No Content-Security-Policy yet: the inline scripts and Firebase's
  hosts would need hashing and listing, and a wrong one breaks sign-in; do it report-only first.
- Alerts: `SCC.alertsFor` decides (pure, tested), `alertUser` and `deliver` in `functions/index.js`
  send Firebase Cloud Messaging data messages to the tokens in `users/{uid}/private/alerts`, and
  `sw.js` shows them. Keep each alert's key stable, or people get repeats: `out|week|league|player|tag`
  (names the starter's backup when he's a free agent there: depth chart order is index 3 of each
  trimmed player), `check|week|kickoff` (one alert covering every league), `news|week|story|player`,
  `waiver|week|date` (`SCC.waiverReminder`, pref `waivers`: at the 8 PM Eastern check the evening before a Sleeper
  league's waivers run; Sleeper's `waiver_day_of_week` counts from Monday and claims process about 3 AM Eastern,
  checked on real claims 2026-09-13; daily-waiver, ESPN and Yahoo leagues aren't counted).
- ESPN turns Titan's server away at times (403, since 2026-09-12). Don't add a User-Agent naming
  Titan to ESPN requests: ESPN refused one even from home (checked 2026-09-12). Each ESPN feed the
  server shares keeps its last good copy in Firestore (`meta/newsFeed`, `meta/scoresFeed`,
  `meta/gameContext`; `saveCopy` when it changes or every 15 minutes, `fallback` when ESPN refuses),
  so a new instance serves it instead of a 502: news up to a day old and game context six hours, past
  which the request fails and the alert fires; scores half an hour, past which `/api/scores` answers
  `{unavailable: true}` (not an error, so no alert) and the ticker reads ESPN's scoreboard in the
  browser (`scoresFromEspn`: ESPN sends `Access-Control-Allow-Origin: *`, and on 2026-09-14 it
  answered Node and curl from home while refusing the server and PowerShell). The News tab notes a copy over
  15 minutes old (`NEWS_OLD`), and news alerts skip a copy over 10 minutes old (`NEWS_FRESH`) and ask
  ESPN directly. The "Titan server problems" alert matches warnings containing "could not", so keep
  those words out of warnings that aren't problems.
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
  seconds, CDN 20; `ESPN.scoreboardFrom` gives each side's points and the short status; the browser
  reads ESPN's scoreboard itself when the server answers `unavailable` or fails). It sits under
  the header, not in it, so the sticky header (and the wide screens' sticky league list below it) keep
  their place. It reads every 30 seconds while a game is live or kicks off within 10 minutes, every 10
  minutes otherwise, only while the page is in view, and never in the demo. Each game links to its
  ESPN page, "Scores: ESPN" credits the source, and a badge counts the person's starters in the game.
- Game context on Lineups rows (`SCC.gameTags`) comes from the `gameContext` function at
  `/api/game-context` (kept 30 minutes): ESPN's scoreboard lines (`ESPN.scoreboardFrom`,
  `SCC.impliedTotals`), NWS forecasts at kickoff for outdoor US games (`STADIUMS` holds each home
  stadium's spot; NWS needs a User-Agent), and points allowed by position (`SCC.dvpFrom` over
  nflverse's `stats_player_week_<season>.csv.gz`, CC BY 4.0, credited on Lineups; last season's
  until three weeks are played; Firestore `meta/dvp`, 12 hours).

## Yahoo

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

## Website, Android app and credits

- The Android app opens `/?source=play`. The website's forward to `/app/` (with the query) must
  keep working, or the Play app shows the website instead of the app.
- Every page credits Titan Forge, the owner's web development business, at the bottom: "Developed by Titan Forge"
  linking to https://www.titanforgedev.com, in the website's copyright line (home and guides), the app's `foot-note`,
  and the closing line of privacy and terms. A new page gets it too.
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
- The Titan Waiver Wire, Titan's free weekly email, runs on Kit (the newsletter service, free plan). `newsletter.js`
  handles every signup box (`form[data-newsletter]` inside `[data-newsletter-box]`): the home page's hero and its
  `#newsletter` section, the `/newsletter/` page, every guide, and the app's `newsletterCard` on Waivers and Settings. It
  posts the email to Kit's form endpoint (`https://app.kit.com/forms/<FORM_ID>/subscriptions`, field `email_address`;
  no key, so no server code) in the background, shows a pop-up saying to check email to finish (`popup()`, `dialog.nl-pop`), and remembers a device that joined (`titan.newsletter`), which hides the
  boxes marked `data-hide-joined` and the app's cards. `FORM_ID` in newsletter.js is Kit's form number (public; the
  "Titan Waiver Wire" form, 9921118, set 2026-09-15); while it's empty every box stays hidden. The UI test overrides it
  with `window.TitanNewsletterForm` ('' for none) and answers Kit's address itself: tests never post to the real form. A new website page gets a signup box too. Beyond the boxes, links that stay for everyone, joined or not: a
  "Free weekly email" pill beside the app's title (`.nl-top`, hidden at 720px and narrower), "Weekly email" in the
  app's footer, and "Weekly email" in every website footer's `.foot-links` (a new page's footer gets it too).
  New subscribers get this week's issue on the page Kit's confirmation link opens (`/newsletter/?joined=1`), and any
  joined device sees it there: `issue()` in newsletter.js reads Firestore `public/waiver-wire-latest` over REST (anyone
  can read `public/`; only the owner's PC writes it, through titan-analytics' upload.js) and draws it in a sandboxed
  iframe. `public/` is readable by the world: only the usage picks ever go there, never FantasyCalc's values, the
  owner's leagues or anyone's data. The privacy page's "If you join the
  weekly email" section and the Play Data safety form (email address, collected when someone signs up) must stay true.
  The email itself is drafted by titan-analytics each Tuesday (`reports/newsletter-latest.html`, from nflverse usage
  only: never FantasyCalc's values, never the owner's leagues). Its `newsletter_send.py` then puts the issue into Kit as a
  draft broadcast (Kit's API; the key stays in titan-analytics' config.json, never in this repo); the owner looks it over
  in Kit and sends it there. Nothing sends on its own, and a sent week is never sent again.

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
trigger a run and read its logs, then send the owner a push notification (every deploy, in every project).
A save point is an annotated tag `vX.Y.Z`, a row in README's
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
