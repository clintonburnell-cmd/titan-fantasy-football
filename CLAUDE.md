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
  to-dos. It's private: gitignored, and outside `site/` (the only folder Hosting publishes) so it's never deployed. Bring it up to date
  at the end of a session.
- The rules are grouped by area: Never first, then code and data, navigation and look, the screens, Trade and
  FantasyCalc, the owner's screens, the server, Yahoo, and the website and Android app.
- The loop for any change: test, commit, push, deploy, check the live site, send the owner a push notification,
  then make a save point (Deploying and save points, below).

## Where things are

| File | What it does |
|---|---|
Everything the browser loads lives in `site/` (firebase.json's `public` folder since v1.44.0): the repo root, `functions/`
and `tests/` are never published. The paths below are inside `site/`; URLs are unchanged (`/app.js`, `/app/`).

| `index.html`, `site.css` | The website at the root: what Titan is, features, FAQ. In a browser it always shows the website (the owner's call: never forward browser visitors, even with a saved account). Only the Android app's `/?source=play` and home-screen copies go to the app, keeping the query; `/?home` shows the website even there |
| `titan.svg` | The Titan banner art (hand-drawn vector). The Play feature graphic (`titan-android/store/feature-graphic.html`) and the share image `og-image.jpg` (`titan-android/store/og-image.html`) use it too: re-render both after changing it |
| `icon.svg`, `icon-maskable.svg` | The brand mark (v1.88.0): the Titan's helmet seen head on, its visor the letter T, the same helmet the hero art wears. Three shapes so it survives a 16px browser tab. The maskable one is the same art full bleed at 0.68 scale, inside Android's safe zone. After changing either, run `node tools/icons.js`, which renders `icon-192.png`, `icon-512.png`, `icon-maskable-512.png` and `apple-touch-icon.png` from them, and bump `CACHE` in `sw.js` |
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
| `extension/` | Titan Fantasy Assistant, a Chrome extension loaded unpacked for the owner (named "Titan for Sleeper" until v0.6.0: a product name carrying another service's mark implies an endorsement, so it was dropped; "Sleeper" stays only where it states what the extension works with) (its README has the build and load steps): pills after player names and a league panel on sleeper.com from the owner-only reports; signs in through `site/ext/connect.html`; never writes to Sleeper |
| `functions/index.js` | `freezeCalls` (every 15 minutes on game days), `espnLeague` and `espnLogin` (private ESPN leagues and the saved login), `deleteMyAccount`, the `/api` feeds |
| `tests/` | `node tests/run.js` (`T.ROOT` is `site/`; the server tests reach `functions/` through `T.ROOT/..` since v1.59.1, and they skip, not fail, when `functions/node_modules` is missing: a `skip` line in the run means they didn't run) |

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
  per-position `pointsOverrides` on receptions becoming `bonus_rec_*`); Yahoo leagues from `settingsFrom`
  (`YAHOO_STAT`: Yahoo's stat ids in Sleeper's keys, stat 16 being one two-point stat for all three, v1.45.0). Pass the league
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
  keep them light. Injury tags ride the same tick every `INJ_TICKS` (5) minutes on game days
  (`API.refreshInjuries` → `SCC.taggedIds`/`SCC.applyInjuries`, v1.76.0): only the rostered players already carrying
  a tag are re-read, since Questionable turning into Out is the change that matters and a full refresh is half an
  hour away. Questionable never benches anyone (`INJ_OUT` is Out, Doubtful, IR, PUP, Sus, NA, DNR, COV). ESPN's box score is ~230 KB, so it's fetched every other tick.
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
- The sidebar of leagues (`jumpBar` → `sideNav`, wide windows only) does one of two jobs, and the screen says which
  by what it passes: nothing means jump (`data-jump`, the stacked screens), `{pick: <league id>}` means switch
  (`data-pickleague`, the one-league screens: Trade, Standings), and `{pick, all: true}` adds an All leagues entry
  for a screen that can show them together (Byes). A switch keeps the page's scroll position, and does exactly
  what that screen's own dropdown does, which stays for phones. The scroll spy only watches the jumping kind.
- Folding (Lineups, Rosters, Matchup) goes through `isOpen`, `setFold` and `foldAll` in
  `app.js`, keyed by `FOLD_KEY`. Only a person's tap on a header is saved (`tapped`); code
  that opens or closes a league (the Rosters search, jump chips) must not save it.

## Navigation, look and type

- Navigation: six sections (`SECTIONS` in `app.js`): Lineups, Matchup, League (Standings, Rosters,
  Trade, Transactions), Players (Waivers, News, Planning, which is `screenPlan`: Exposure, Byes and Schedule
  strength behind chips since v1.78.0, each keeping its own address through `go`) and Rankings (Import, which is the `ranks`
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
- Every league name shows `leagueIcon(cfg)`, but only a league with a picture of its own gets one (v1.82.0): the
  placeholder Titan icon is gone, since an account of twelve picture-less Sleeper leagues showed twelve identical
  logos. Without a picture it is the site letter alone (`.licon.bare`), and the sidebar shows nothing at all there
  because its second line already names the site. With a picture (`cfg.pic`: Sleeper's league avatar,
  or your team's logo in an ESPN league, kept through `slimLeague`) with a lettered site badge in the
  corner (not the sites' logos), or the Titan icon (`/icon.svg`, `NO_PIC`) when there's no picture. Give Yahoo a `pic` too.
  On Matchup, your score in the middle is red when you're behind, or purple (`--fav`) while you're behind but
  still projected to win (over a 50% chance); the status line says so in words too.
- Today opens with what changed since the app was last closed (`changedLine`, `SCC.whatChanged`, `lookSnapshot`,
  `KEY.look`). `S.look0` is read once at boot and never updated during a visit, so the list does not vanish while
  it is being read; `saveLook` rewrites the stored snapshot after every analysis for the next visit.
- Where Titan has a record, it shows it (v1.85.0): the close-call notes carry the season's graded record once
  there are `CALLS_MIN` (5) scored calls, and say it is the record for close calls as a whole. Add a number like
  this only where it is honestly computed and honestly described.
- **Sizes, corners and spacing are tokens, not judgement calls** (v1.84.0): `--t-2xs` to `--t-2xl` for type and
  `--r-sm/md/lg/pill` for radii, in the first `:root`. A new literal `font-size` or `border-radius` is a nudge, not
  a decision: pick the nearest token, or change the token if the whole scale is wrong. They replaced 42 sizes and
  10 radii. Long instructions live behind a `.how` fold, not above the thing they describe.
- **Speed is measured, not guessed at**: `node tools/perf.js` walks a cold first visit on a throttled phone and prints
  the waterfall, first paint and the moment a lineup is readable; `--warm` measures the second visit. Run it before and
  after any change meant to make the app faster and put the numbers in the save point. Two ideas that read well on
  paper lost when measured and were reverted (warming Sleeper's requests from an inline script, v1.85.0; a
  `Content-Encoding` on the projections endpoint, v1.89.0). The document's own time swings by about a second between
  runs, so compare several, and compare runs whose first paint is similar.
- The home page's screenshots come from `node tools/shots.js` (Chrome for Testing, the live demo at 390px) into
  `site/shots/`. Re-run it when a screen it shows changes shape rather than editing images by hand.
- Type: both the app and the website (v1.84.0; it was the app alone) use Inter (`fonts/inter-latin-wght.woff2`, fontsource's Latin variable build, SIL Open Font
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
- Dialogs (`openPlayerCard`, `openDraftResults`, `openSearch`) return focus to what opened them (`pcOpener`,
  `dlgOpener`, `psOpener`). The player searches share `indexOf(players)` (names normalised once per player list)
  through `searchPlayers`. Find a player (v1.43.0): the magnifier in the header (`#psearch-btn`, shown with the
  gear once there's a snapshot) opens `dialog.psearch` (`searchDialog`), a search over every NFL player with
  where he is in each league (`wStatus`); a name opens his card on top; Back closes it (`popstate`, like the card).
- Schedule strength (`screenSos`, tab `sos`, `/app/schedule`, under Players, for everyone): `SCC.scheduleStrength`
  (pure, tested) over Sleeper's NFL schedule (`API.nflSchedule`, kept in `S.sos`) and the game context's
  points-allowed ranks (`S.ctx.data.dvp`), a position at a time (`S.ui.sosPos`, chips `data-sos-pos`): each team's
  next games, the average opponent rank over the next four weeks, the rest of the regular season and weeks 15 to
  17, and your players on that team. Standings' playoff picture (`playoffPicture`, `.ppic`): each game still to
  play this week run both ways through the standings simulation (`PICTURE_SIMS`), your own game first, then who
  to root for by the swing in your odds. Lineups' "Copy changes" (`data-copy`, the moves as text; a generic
  clipboard listener). The player card ends with "In the news" (`playerNews`: ESPN's stories tagging him from the
  News feed, loaded if it isn't yet; `loadNews` repaints an open card). Value and Data dump tables share
  `reportTable` (`rt` formatters; each screen passes its columns).
- Each league's card on Lineups and Rosters opens with `leagueAdvice(cfg)` (v1.47.0, `.lg-advice`): where the roster is
  deep or thin among QB, RB, WR and TE (`strengthOf`, the same numbers as Standings' Position strength), its playoff
  odds and seed (`standingsResult`), and one suggestion from the two (trade from depth, fix it on waivers, patch it
  before the playoffs, or sell veterans on long odds in a dynasty league). Every piece loads quietly and the line fills
  in as it arrives: the season projections and the league's teams are cheap, so only `ADVICE_AT_ONCE` (2) leagues fetch
  the heavy schedule at a time, and none while a refresh is running. The demo and Yahoo leagues get nothing.
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
- Close calls on Lineups (`closeNotes`, v1.41.0): for each starter with a bench player at his position within `CLOSE`
  ranks, or, when both carry a tier from the weekly rankings, in the same tier whatever the rank gap and never across
  tiers (`SCC.closeByRank`, v1.58.0) (`SCC.closeCallPairs`, pure, tested), a note gives both players' floor and ceiling (`SCC.spreadOf`: the
  projection give or take the player's usual swing, his PPR points over the last three finished weeks from
  `loadUsage`, `statWeeks`, blended with his position's usual `SPREAD_CV`), who has the softer matchup (`dvpRank`
  from the game context) and a lean from the win chance (`winChance`, from the Matchup data, loaded quietly): the
  higher floor when you're the favorite (60%+), the higher ceiling as the underdog (40% or less). The note never
  changes a call. Beside it (v1.70.0), `disagreeNotes` flags where the projections disagree with the person's own
  rankings (`SCC.disagreements`: a bench player whose tilted projection beats a starter's at his position by `DISAGREE`
  (3) or more while the rankings put them well apart, so not a close call); it never changes the call either, and shows
  only with the person's own rankings for the week. Matchup's card shows each side's range (`rangeLine`: points so far plus the floors, and plus the
  ceilings, of the starters yet to play).
- What a lineup change is worth (v1.83.0, `changeWorth` under the moves on a league card): `SCC.lineupSwing` runs
  `winProbability` twice against the same opponent, the lineup as it stands and Titan's, from the Matchup tab's own
  lists (`winList`, `recWinList`). It draws nothing until the matchup has loaded and nothing on a later week's plan.
- A hurt player's practice report (v1.83.0): `fetchDetails` reads Sleeper's `practice_participation` and
  `practice_description` into `prac`/`pracNote`, `applyDetails` and `applyInjuries` carry them, and
  `SCC.practiceNote` turns them into words with a lean (full participant up, did not practise down). It is shown,
  never acted on: it does not bench anyone and does not move the tilt.
- The matchup tilt (v1.42.0): `analyze` hands `SCC.analyzeAll` a `tilt(p, cfg)` (`tiltFor`: the projection in the
  league's scoring, +8% against the eight softest defenses to his position, -8% against the eight toughest, through
  `matchRank`, which since v1.73.0 prefers the week's Match Up data sheet (`SCC.matchupRank`, the owner's and the lab
  crew's) over the game context's ranks and falls back to it; `SCC.tiltFromRank` holds the shape, and the close-call
  note, the player card's read and the compare view read the same `matchRank`, so one number explains the call.
  Loading the sheet is part of `analyze`, and `loadMuData` re-runs `analyze` when it lands, as `loadContext` does. The
  extension's worker passes the same tilt. Three rules hold it in place since v1.75.0, after it started a Questionable
  WR59 over a healthy WR46 on a six-point projection gap with matching matchups: the same tier is close only within
  `CLOSE` ranks too (`closeByRank`), a player with an injury tag is never tilted in over a healthy starter, and the
  flip needs `opts.rankOf` to say the bench player's matchup is the softer one (no `rankOf`, no flips). **Never widen the tilt to non-close calls:** his weekly rankings
  are matchup-aware already, so the sheet is a tiebreaker, not a second opinion. The bar moves only on what the graded
  close calls say. Also from the game context, plus the game's own pull since v1.50.0, `SCC.impliedTilt`: his team's expected points from the
  betting line against the average side this week, 0.4 of the difference and never past ±10%, so a team expected to
  score 27 against an average 22.5 lifts its players 8%; a close call's note also says which team is expected to
  score more when it's 4+ points apart, `impliedOf`) and `analyzeLeague` lets a bench player take a close call's spot when his tilted projection beats
  the starter's by `TILT_MARGIN` (1.5); the card says so (`L.tilts`, "Matchup tilt"). Only close calls (within
  `CLOSE` ranks) can flip; everything else follows the rankings. The server's frozen record has no tilt, so Results
  can differ from the app on those spots. `loadContext` re-runs `analyze` once the context is in.
- Matchup: where you stand, in words, comes from `SCC.matchStatus` (pure, tested) through `matchState`
  in `app.js`, which the card and the summary at the top share; the summary's filters are
  `MATCH_KINDS` (`S.ui.matchFilter`, chips `data-mfilter`). Opened, the scoreboard (`.board`) shows the
  score, so the header's score row hides.
- Standings under All leagues (v1.46.0) leads with your playoff odds in every league (`oddsOverview`, `.podds`: each
  league's schedule and teams load quietly and its simulation runs, rows fill in best odds first, a row
  (`data-stand`) opens that league's full standings below, `S.ui.standLeague`).
- Standings also carries what this week's result is worth (`whatIf`: the simulation twice more at `WHATIF_SIMS` with
  `opts.force = {week, team, win}`, which only sets the order of a game's scores, never their size) and how each
  manager has played it (`managerCard`, `SCC.managerReport` over the league's transactions and today's values;
  a category with nothing in it is null, so a quiet manager is blank rather than last). Both wait for the league's
  teams, and the manager card asks for the transactions itself.
- Results holds two views behind chips (v1.87.0, `SCORE_VIEWS`, the shape Planning uses): **This week** (`scoreWeek`,
  the old screen) and **By week** (`screenByWeek`), every rostered player's points week by week for one league. The
  season's stats load once per visit (`loadByWeek`, `S.bw`, one `API.fetchStats` per week) and `SCC.weeklyPoints`
  scores them in that league's `cfg.ppr`. A week not played is null, never zero, in the engine, the table and the
  chart; the average counts only the weeks he played. `S.ui.bwPick` holds up to `BW_MAX` players for the chart and
  `S.ui.bwLeague` the league, which the left rail picks like the other one-league screens.
- A projection moves once the game does (v1.86.0, `SCC.liveProjection` through `projOf`): points plus half of what
  is left while a game is on, the points once it is over, the plain projection before kickoff and on a planned
  later week. It must keep agreeing with `winProbability`, which makes the same assumption.
- The Standings tab (`SCC.standings`): records, all-play, luck, power and playoff odds from 5,000
  seeded simulations (each team scores around its mean with its own swing: the spread of its weekly
  scores blended with the league's, `SD_PRIOR` games' worth, clamped 8 to 45). Divisions (v1.45.0): each
  team carries its `division` (Sleeper's roster `settings.division`; ESPN's `divisionId` + 1) and the league
  its `seedType` (Sleeper's `playoff_seed_type`: 0 division winners take the top seeds, 1 they're in but seeded
  by record, 2 divisions ignored; ESPN 0); with two or more divisions each division's best record takes a spot
  (`seedsFrom`), the table's ★ marks today's division leaders (`divWinner`), and `simOpts` hands the same
  settings to the playoff picture; schedules from `API.leagueSchedule` (Sleeper matchups, or ESPN via
  `ESPN.fetchSchedule`; private ESPN leagues through `espnLeague` kind `schedule`).
- Position strength (`SCC.positionStrength`, pure and tested): each team's best lineup this season
  by Sleeper's season projections (never FantasyCalc's, so everyone sees it), starters added up by
  position plus a quarter of the best bench player there, ranked across the league; 'deep' is 0.6
  standard deviations or more above the league's average at the position (`z`), 'thin' that far below
  (was terciles until v1.41.0). Standings shows every team's ranks (`strengthTable`, table `.pstr`, not
  `.stand`, which the UI test counts); the Trade tab shows the partner and you once a partner is
  picked (`tradeFit`, "Where you both stand", with the good fits). Both load the season projections.
- The Transactions tab (tab id `moves`, address `/app/transactions`): each Sleeper league's last three
  weeks of completed transactions (`API.leagueTransactions` → `SCC.transactionsFrom`), reloaded every
  five minutes while the tab is open. A league picker (`S.ui.movesLeague`, remembered) narrows the list; the kind chips'
  counts follow it. ESPN leagues too (v1.45.0): `ESPN.readTransactions` (`view=mTransactions2`, the players named from
  ESPN's player list as the draft is; private leagues through `espnLeague` kind `transactions`) and
  `ESPN.transactionsFrom` (trades are `TRADE_ACCEPT` with an ADD item per player carrying both teams; claims `WAIVER`
  or `FREEAGENT` with ADD and DROP items; anything else is left out). Written to ESPN's format as best known and tested
  on a made-up answer: **not yet checked against a real ESPN league**; the owner's ESPN test league is the place to look.
- Streamers this week (Waivers, `streamCard`, v1.74.0): kickers and defenses turn on the game, not the season, so the
  free agents at those positions are ordered by `SCC.streamPicks` (pure, tested): a kicker by his own team's expected
  points, a defense by how few the offense it faces is expected to score, both moved by `tiltFromRank` on the matchup.
  Only in leagues that start one, free agents only, with the bid and the starter he'd replace. It needs the game
  context, so it draws nothing until `/api/game-context` is in.
- **Screen length is a test** (v1.80.0): the UI suite walks every screen at 390px and fails when one goes past its
  budget (`BUDGET` in `tests/ui.test.js`), naming the tallest block. Raise a number there only with a reason, and
  fold or cap the block instead where you can. The long lists all cap now: News `NEWS_FIRST`, trending pickups
  `TREND_FIRST`, the combined preview `MULTI_FIRST`, with the rest behind a button; a waiver league's claims and a
  roster's bench and reserve fold. `skeleton(n, label)` is the loading state: rows the height of the real ones, the
  words kept for screen readers.
- Density is a feature (v1.78.0, measured on a 390px phone): a recommended row shows the game context, the why line
  and the rank note only where a decision is being made (`rowDepth`: a change, or a close call), and everything that
  explains the calls folds behind one line (`.lg-notes`, `.lg-cmp`). Before adding a line to a row, ask whether it
  changes a decision on every row or only some; nine rows a league and twelve leagues is how a tab becomes
  unreadable. Re-measure with the demo at 390px rather than guessing.
- Lineups' rows carry two lines beyond the rank (v1.74.0): `whyStart` (`SCC.nextBest`: the best bench player who fits
  the spot and how far back he is, or that there is no other fit) so a call can be checked, and `roleFlag` (the snap
  share rising or falling from `SCC.usageOf`, which Lineups now loads as Waivers does). Neither shows on a later
  week's plan.
- The Waivers tab: the waiver plan (`planCard`, from `SCC.waiverPlan`, pure and tested: claims from the
  rankings' wire targets `L.wire`, at most three a league, and a drop for each: the bench player with the
  lowest season value (`planValue`: Titan's value, then season projected points, so a star on bye is
  safe) that isn't on IR or the only bench player at a position the lineup starts; a kicker or defense claim
  (v1.71.1, the owner's rule) drops only a kicker or defense: the spare on the bench, else the one he outranks
  (`w.cur`), never an open spot or a skill player (`like` on the claim; the dropdown lists that position only);
  a dropdown swaps him;
  Done and changed drops are `S.ui.wplan`, started over each week; `cfg.bench` counts open roster spots),
  free backups (`SCC.backupOf`), Sleeper's
  trending adds (`API.trendingAdds`) with where each is free (`L.takenNorm`), a search, and bids
  (`SCC.faabBid` from `API.leagueWaivers`: a Sleeper league's last six weeks of winning bids, scaled by the points a
  game the claim adds over the starter he replaces, `gain`, and by how many other teams would start him,
  `SCC.rivalsFor` over the league's teams, which Waivers loads quietly for FAAB leagues; the reasons show under the
  bid). Each pickup
  shows a usage line (`usageLine`, `SCC.usageOf` over the last three finished weeks of `API.fetchStats`).
- Compare two players (v1.71.0, `openCompare`, `compareHtml`, in the player card's dialog): "Compare with…" on a card sets
  `S.cmp = {a}` and opens Find a player, whose next pick is the second player; the dialog then shows both side by side in
  the league picked (rank note, projection with floor and ceiling, matchup, next four weeks, rest of season, usage, where
  in your leagues) with a read at the end. `repaintCompare` redraws it when usage, the season projections or the context
  land. Opening a card clears the compare. The Trade tab's "Paste an offer" (`applyOffer`, `SCC.parseOffer`) fills a
  trade from pasted text through `S.trade.pending`, the rosters settling whose side is whose. Today's weekly recap
  (`recapCard`) reads the week kept by `keepWeek` (now with `miss`, the bench's biggest miss) and `pushRecap` sends it to
  `users/{uid}/private/recap` for the owner's Tuesday briefing (`recapLine` in functions).
- The player card (`openPlayerCard`): any element with `data-pcard` (`pcAttr`, players with a Sleeper id)
  opens a `<dialog>` with the player's last four games and season from `API.fetchPlayerStats` (Sleeper's
  per-player stats, `grouping=week`; `trimStat` in sleeper.js keeps what Titan shows), under "Titan's read"
  (`playerRead`): this week's floor and ceiling, Titan's rest-of-season value, the matchup, and for the owner the
  Value report's usage rank against the market with its call, all for the league picked (or the first), so a
  player reads the same on every screen. Exposure lists the players you lean on most first (by lineups started
  in, then teams owned), the meter's darker bar being the starts. Back closes it, like
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
  `--chart-bar`, checked with the dataviz palette checks in both themes; a table sits behind it. Close calls, graded
  (v1.70.0, `callsCard`): `recordCalls` (from `analyze`) keeps each week's close calls as they stood before kickoff in
  `KEY.calls` (the pick, the other, `flip` when the matchup tilt made it, both tilted projections; a pair with a locked
  player stays as recorded, one that stops being close is dropped, nothing under the default rankings or in the demo),
  `gradeWeek` scores them from the scored rosters' points (`SCC.gradeCalls`, a player counted once his game is over)
  and `keepWeek` stores each finished week's totals (`calls`) so the card adds the season up. Never let the record be
  rewritten after a player locks: that is what makes the grade honest.
- Season rankings (`screenSeason`, tab `season`, `/app/season`, under Rankings after Import; v1.48.0, the owner's ask): a
  person's own rest-of-season or dynasty list for each kind of league (`SCC.SEASON_FORMATS`: 1QB or superflex, redraft or
  dynasty, each with a TE Premium list; `SCC.seasonFormat(cfg)` picks a league's `key` from `tradeFormat` and
  `cfg.scoring.bonus_rec_te`). A league uses its TE Premium list when it pays tight ends extra and one is saved, else its
  format's Standard list (`seasonListFor`). Tiers count (v1.58.0): with a tier column on the list, `SCC.seasonValues`
  pulls tier-mates `TIER_FLATTEN` (0.75) of the way to their tier's mean value (within the position when the list is
  ranked that way) and reports `tiered`, so tier-mates trade about even and the cliffs sit between tiers; every scale
  (`fc`, `tv`, `tvpos`, `proj`) gets it. Each chip carries a status dot (`seasonDot`, `.sdot`; v1.51.2): green with a
  list saved, amber when the person's leagues use that kind and none is saved (they follow the market until then), hollow
  grey when none of their leagues is that kind, with a legend (`.season-legend`) under the chips; amber, not red, so a
  kind they don't play never nags. `SCC.seasonValues` (pure, tested) turns the list into values on a market's
  scale: the person's Nth player takes the market's Nth-highest value (a list ranked within each position maps within the
  position), and unlisted players keep their market value. **The market still decides what's fair** (the owner's call):
  `tradeVerdict` is unchanged, and the season list only feeds the edge (`edgeFor`, source 'season', ahead of the owner's
  Value report). `seasonIn(cfg, scale)` memoizes by list and market: 'fc' (FantasyCalc's, the trade math for everyone
  and what the owner sees), 'tv' (Titan's own, what everyone else sees), 'tvpos' (Titan's within each position, Position
  strength). Never show a non-owner a number from the 'fc' scale: the edge line gives them a percent. Also used by the
  waiver plan's drops (`planValue`: a listed player beats any unlisted one, `seasonRankOf`), draft grades and
  `strengthOf` (so `leagueAdvice`, trade fit and trade ideas follow it too). Stored as `KEY.seasonRanks` and synced to
  `users/{uid}/seasonRanks/{format}` (rules, index exemption on `rows`, `Plan.ranksPlan` newer-wins, `pushSeason`).
  The owner's sample (a Late-Round rest-of-season export) is paid: never commit one; tests build their lists from the stubbed values.
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
  a note (`.tdyn`) that Titan's values are this season's projections tilted by age (`titanValues` opts `dynasty`,
  `SCC.ageFactor`, `AGE_CURVE`: judgement, backs fade from 27, receivers from 30, quarterbacks hold to the mid-thirties;
  the player list's v3 keeps each player's age, `trimPlayers` index 4). Both
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
  (`lineupPoints` with values, not one week's projections), at most two per partner. Since v1.53.0 the app
  asks for the lineup goal (`goal: 'lineup'`, with rest-of-season `points`; the owner: "the goal is to
  find the most optimal starting lineup... make playoffs and win"): an idea must add rest-of-season points
  to your best lineup and still gain value by your own numbers (`trueGain`), except a consolidation that
  adds `LINEUP_BIG` (1) point a week or more, which may cost a little value (the market's verdict keeps it
  fair); ideas rank by points a week plus `LINEUP_VALUE` (20) × the value gain as a share of the lineup's value
  (v1.54.2; v1.53.0 ranked by points alone and the owner said the ideas "got worse"). The points themselves come
  from the owner's season rankings when he has a list for the league's kind (v1.55.0: `seasonIn(cfg, 'proj')`
  maps the list onto the season projections' points, his order and their spacing; `seasonProjFor` is the map
  `spanFor` reads, at PPR 0 since it's already in the league's scoring; `pointsSource` says which), else
  Sleeper's projections; the ideas card and the lineup table say which. The partner's lineup is judged by
  `theirPoints` (the public projections, `spanForPublic`) while yours follows your rankings (v1.56.0); with
  `guard` on, an idea may not weaken a starting position you aren't deep at (`myDeep`, `SCC.positionPoints`,
  `GUARD_WEEKLY` 0.5 a week), and the positions it strengthens are its `ups` (an idea upgrading more than one
  ranks higher, `UPGRADE_BONUS`, and says "upgrades your RB and WR by your numbers": the owner's "both upgrades"
  edge). A player's status counts (v1.57.0): `SCC.missWeeks(inj)` is the rough timeframe his status implies
  (`MISS_WEEKS`: Out/Doubtful 1, NA 2, Sus 3, IR/PUP 4, DNR 8; Sleeper has no return date), `spanFor` and
  `spanForPublic` start his points that many weeks later, and `tradeIdeas` takes `miss(p)` and `nowPoints(p)` (this
  week's projection, 0 for a player who's out) to say when an incoming player is out, carry `myNow` (this week's
  lineup change), and rank an idea lower the more it costs this week (`NOW_COST` 0.05 a point, floor `NOW_FLOOR`
  0.6). `skipPos` keeps positions out of both pools: the app passes `['QB']` in one-QB leagues (the owner
  doesn't want QB-for-QB ideas; a quarterback is easy to find), and the card says so (`I.noQb`). They get a +1 to `accept` ("comes from their
  depth at WR") when everything you get is at a position the partner is deep at (`deep`, from
  `positionStrength` like `thin`). `SCC.tradePartners(meId, PS)` (pure, tested) lists the partners whose
  rosters fit yours (thin where you're deep, deep where you're thin, `PARTNER_GAP` 0.6 z apart) and the
  card shows the top four above the ideas, each idea leading with the points it adds (and per week,
  `I.weeks`). The ideas card is one line until Find trades, and Clear folds it back. The Trade tab's League and
  Trade partner pickers (`pickBar`, v1.54.1) render twice, at the top (with Clear all) and again right above the
  trade summary and rosters (`.tpick-trade`); `data-ui="tradeLeague"` sets `S.ui.tradeLeague` (and `S.ui.league`
  when the top dropdown names a league) and clears the partner. The edge (v1.39.0, the owner's ask for "an edge in statistical
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
  the order). The impact table (`lineupImpact`, `.tl-t`) shows this week, the next four weeks (v1.70.0: tilted up to 8%
  either way by each player's schedule, `sosNext4`, the next four weeks' average opponent rank for points given up to
  his position from Schedule strength's numbers; `loadSos` loads the NFL schedule for the Trade and Value tabs too, and
  the Value report's Next 4 column shows the same span's points with that rank), the rest of the regular season
  (`LAST_REG_WEEK` 17) and the playoff weeks (`cfg.playoffStart` or 15, three weeks; for the owner tilted up to 10% by
  the Data dump's playoff schedule rank, `playoffTilt`). Batch B (v1.40.0): ideas allow two for two; in a dynasty or keeper league each
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
  A Sleeper league's team page (`lineupUrl`, from `SCC.sleeperTeamUrl`) is the plain web link on every device.
  **Never make it an Android intent again:** Sleeper's apps take only chat links from outside (/channels, /topics,
  /topic, /message in its app link files, checked 2026-09-16), so an intent aimed at `com.sleeperbot` for a league
  page can't resolve and Chrome sends it to the Play Store even with Sleeper installed (v1.34.1 to v1.47.1 did; the
  owner hit it on his phone, 2026-09-16). A plain link opens the league on sleeper.com, and Android would hand it to
  the app by itself if Sleeper ever claims league pages. Never store the
  owner's Sleeper login to act for him (asked 2026-09-15; declined: no write API, Sleeper's terms, credential risk).
  Sleeper can't be pre-filled: its API is read-only, and its web trade page (`/beta/leagues/:id/trade`,
  checked 2026-09-11) takes only the league and sits behind flags that are off. Never ask for Sleeper logins.

## Titan's owner

The owner's account (the `titanOwner` claim) and the screens only it sees.

- Titan's owner is the one sign-in account with the `titanOwner` custom claim. `ownerStats`
  refuses everyone else and returns totals only: never add per-person details to it.
- Compare rankings (`screenLab`, tab `lab`, `/app/compare`) is Titan's owner's, and since v1.65.0 also anyone
  the owner grants the `titanLab` claim (`titan-analytics/grant-role.js <email> titanLab`; `S.owner.lab`,
  `canSee`): they see that one screen and the rules let them read only `lab/<season>-<week>`. The Value report
  and Data dump stay owner-only (his leagues, his paid draft guide): never widen them to `titanLab`. The server's `run` saves FantasyCalc's values once a week
  (`labSnapshot` → `lab/{season}-{week}`, every format in `lab/config` plus any cached in `tradeValues`;
  `late` when saved after the week's first kickoff, and a late week doesn't count for FantasyCalc). The
  owner's app keeps `lab/config` (`sendLabFormats`, keys like `redraft-1qb-12teams-1ppr`, matching
  `valuesKey`). Only the owner can read `lab/` and write `lab/config` (firestore.rules). `SCC.labWeek`
  (pure, tested) scores lineup points (scoreLeague's by-rank per source) and order (rank correlation
  against Sleeper's stats feed, `API.fetchStats`, PPR). Finished weeks are kept on the device (`KEY.lab`).
- Match Up data (`screenMatchups`, tab `matchups`, `/app/matchup-data`, after Data dump under Rankings; v1.72.0) is for
  the owner and the `titanLab` accounts (`canSee`): the owner's weekly matchup sheets (Overview, Passing, Rushing: one
  row per offense, ranks 1 to 32 and a few value columns), kept as `lab/matchups-<season>` ({season, weeks: {week:
  {overview, passing, rushing, at}}}, each table `SCC.parseMatchups`'s shape: cols, rows [{team, opp, home, v}],
  ranks). The owner uploads a week by pasting each sheet as text into the screen's form (`uploadMatchups` →
  `labWrite`) or with `node upload.js matchups <season> <week>` in titan-analytics (TSVs in reports/matchups/, out of
  git: the sheets are his paid source, so they reach `lab/` only, never `public/` or the newsletter). The rules let the
  owner write `matchups-YYYY` and titanLab read it. Shading is inline (`muShade`: green 1 to red 32 with alpha, so both
  themes work); a dot marks the teams the person's starters play for in the league picked.
- Coach Speak (`screenCoach`, tab `coach`, `/app/coach-speak`, last under Rankings; v1.90.0) is **Titan's owner's
  alone**: not `titanLab`, and the firestore rule lets him write `coachspeak-YYYY` without adding it to the titanLab
  read. It holds the Coachspeak Index's ratings (thecoachspeakindex.com, his source): how often each NFL head coach's
  word turns out to be true, in four categories (injuries, depth chart, usage, transactions), thresholds `SCC.CS_TRUST`
  85, `SCC.CS_OK` 75, `SCC.CS_DANGER` 65. **There is no feed**: the site renders the numbers as images with empty alt
  text and keeps the full ratings in its Discord, so he pastes them in (`uploadCoachSpeak` → `labWrite`,
  `lab/coachspeak-<season>`, one sheet a season since the ratings move slowly; pasting again replaces it).
  `SCC.parseCoachSpeak` is deliberately forgiving, because a Discord post is not a spreadsheet: a line needs a team
  and one number, categories come from words beside a number (`CS_CATS`) or their published order, a lone number is
  the coach's overall rather than a guessed category, and the first line about a team wins so a recap below cannot
  overwrite it. `SCC.coachFlags` is what makes it actionable and is the only part on more than one screen: a starter
  carrying an injury tag whose coach is at or under `CS_OK` on injuries, and a wire target whose coach is that low on
  usage or depth chart. Shown on the tab, as `coachLine` on Today and as `coachNote` under the player on Lineups.
  **It never changes a call**, like the matchup sheet: it says what the thing the call rests on is worth. `coachSheet`
  loads the ratings on first use, so Today and Lineups get them without the tab being opened.
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
  a Where column (Yours, the team, or Free agent); under All leagues, format chips (`S.ui.valueFmt`) pick the lists,
  and the leagues come in the app's own order (`snapOrder`, like every tab; the owner's ask, v1.46.0). A player search (`data-value-search`, `S.value.q`) and the position chips filter
  the moves and tables in place (`applyValueFilter`, which `render` re-applies). The sell-high lists are "Sell high or
  keep" (the owner's name for them, 2026-09-15): every sell-high row and move carries a verdict (`keep` on rows, `k` on
  moves; `callPill`, `moveTag`), keep (`.p-swap`) when the role is a real starter's or the points come from yards on a
  proven skill, sell otherwise; the Data dump's ideas and tables use the same tags, and a schedule-only sell lean has
  no verdict. A claim carries `d`, the drop it suggests (the bench player worth the least; titan-analytics
  `drop_pick`), shown as a `.vr-drop` pill beside the name (v1.51.1, the owner asked "I don't know who I would
  drop"). Each league card's "your team by position" is `L.ranks` (v1.52.0: per position `p`, the rank among the
  league's teams by projection, `m` by the owner's own season list when one is saved, `thin`/`deep` as the calls
  treat it, plus `n` teams and `list`, the list's key), drawn by `needPills` as `.vr-np` pills in the position's
  colors (`.pos[data-pos]`); older reports carry only the sentence `L.need`. titan-analytics reads the owner's
  season lists out of Firestore (`fetch-season.js`, firebase-tools' login, `users/{uid}/seasonRanks`, the account
  whose `account.userId` is the owner's Sleeper id) before each run; a claim needs his list to agree, and QB/TE
  claims need a drastic gap. Value and Data dump rows carry `dg` (v1.54.0, titan-analytics v1.9.0): the owner's
  private digest of his Late-Round Draft Guide (`k` target | avoid | dart, `c` confidence /10, `a` still listed,
  `n` thesis, `w` what to watch), shown by `guidePill` (`.p-guide`) on the Value report, the Data dump and the
  Trade tab's `valueTag`. The guide is paid content for personal use: the digest lives in titan-analytics
  `reports/` (out of git), only reaches Firestore `lab/` (owner only), and never the Waiver Wire or any public
  page; never quote the PDF's text in a repo. Entries carry `s` (v1.59.0), the source: the draft guide, or an
  in-season show ("Q&A 2026-09-15"), and the pill's title says which; titan-analytics `lateround_fetch.py`
  transcribes each week's new Late-Round audio into its `reports/lateround/` for the next session to digest into
  the digest and the notes files (`D:\Claude\titan-fantasy-football-late-round-*.md`). From that Q&A: `SCC.faabBid`
  caps a kicker's or defense's bid at `STREAM_CAP` (3%) of the budget (`o.pos`), and the Value report's claims put
  free agents at the owner's thin positions first. The owner's season lists are Late-Round's rest-of-season CSV,
  which refreshes every Tuesday: the `ownerBriefing` push for the Value report appends `seasonStale` (functions,
  pure, tested; `STALE_DAYS` 6) when a list is stale or none is saved, as the cue to re-import (v1.59.1). The weighting lives in titan-analytics (its README, "How the numbers are made"); Titan only shows it. Each table sits in a box that scrolls
  sideways (`.vr-scroll`) with the player column pinned; its header row follows the page down to the table's end
  (`pinValueHeads` moves it on scroll: sticky can't follow the page out of a box that scrolls sideways). Never add
  FantasyCalc's numbers to anything someone other than the owner can see. The rows carry `rs` (a back's rush share)
  and `gt` (his share of touches in garbage time) since titan-analytics v1.5.0, the Late-Round digest
  (`D:\Claude\titan-fantasy-football-late-round-1126-notes.md`, outside the repo): garbage time counts a quarter
  toward usage, last season's weight in the blend goes by how much one week says about a position (WR and QB most,
  RB least), and a player with 40% of his touches in garbage time is never a buy. Since titan-analytics v1.6.0 (seven
  episodes read together, `D:\Claude\titan-fantasy-football-late-round-themes-notes.md`) the rows also carry `gl` (a
  back's share of his team's carries inside the 10), `ez` (a pass catcher's end-zone targets a game; the Goal line
  column) and `pl` (his team's plays a game; a week's usage is steadied halfway toward a normal count), a touchdown
  scorer with the goal-line work reads keep, a tight end's role shift is read by target share, and young players
  with no last season who already hold a real role join the risers. The Data dump's rows carry `imp` (his team's
  expected points from the betting line, the Team pts column) and `sp` (its spread, negative when favored): its
  adjusted number follows the game after the matchup, and a back on a big favorite gets a little more. Since
  titan-analytics v1.7.0 (Titan v1.51.0) the Value rows carry routes from nflverse's participation data (who was on
  the field for each dropback): `rt` (route share, this season), `prt` (last season's), `tprr`/`yprr` (targets and
  yards per route) and `ptprr`/`pyprr` (last season's), `hv` (the share of his routes with two or fewer receivers on
  the field); the Routes and Per route columns show last season's in grey (`.muted`) until this season's is
  published (the report's notes say so). Never write a Firestore rule that checks the document ID on a read of a
  collection the app lists whole (`ranks`, `seasonRanks`): a list query can't be proved against an ID pattern and
  comes back permission-denied (sync failed for everyone from the 2026-09-15 security release until v1.51.0); keep
  ID patterns on writes.

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
- Projections reach the browser through Titan, not Sleeper (v1.89.0, `/api/projections` → `nflProjections`):
  Sleeper's feed is ~2 MB because it carries every projected stat for every player, and `SCC.trimProjections` keeps a
  fraction of it. The server trims once, keeps it in memory and gzipped in `meta/proj-<season>-<week>` (`gz`, and
  `ngz` for the demo's names; both exempt from indexing), and the CDN holds it, so one read from Sleeper serves
  everyone. 232 KB over the wire becomes 65 KB. `?season&week` is a week, `?season&scope=season` the season,
  `?season&week&scope=demo` adds the player names the demo needs, and **no parameters means this week**, worked out by
  the server (`nflState`) and named in the answer: that is the call `API.earlyProjections` makes at the top of
  `refresh`, in parallel with `API.collect`, so the biggest download no longer waits two round trips to learn the
  week. If the refresh settles on a different week (the Tuesday rollover) the right week is fetched and the head start
  is unused; the demo never makes that call, since `demoPlayers` takes projections and names from one answer.
  `fetchProjections` falls back to Sleeper directly whenever `/api` cannot be reached (with an 8-second limit, so a
  silent server can never hold up the first screen), and Node (the job, the tests) always goes straight to Sleeper.
  A stale copy still serves for a day if Sleeper is down.
- **The size has to come out of the JSON, not out of gzip.** Neither Firebase Hosting nor Cloud Run compresses a
  function's answer, and a `Content-Encoding` the function sets itself is stripped by Google's front end (measured
  2026-09-17: gzip, brotli and identity all came back as the same uncompressed bytes, through Hosting and at the
  function's own URL, cache hit or miss). So `SCC.packProjections`/`unpackProjections` (pure, tested) carry the
  seventy stat names once instead of once per player, which is most of the difference. Don't reach for a compression
  header here again without re-measuring; the helpers are still in `sendJson` if it ever starts working.
- **espn.js, yahoo.js and newsletter.js are not in the page** (v1.89.0) and not in `SHELL`: `loadScript` fetches one
  when it is needed, `loadPlatform` hands it to sleeper.js (`API.useEspn`/`useYahoo`, which replace the globals those
  files used to capture at load) and re-wires sync.js's transports (`window.TitanWireTransports`). `platformsFor` is
  called at boot and on an account change and passes the promise to `API.whenReady`; **the wait lives in sleeper.js**
  (`waitReaders`, at the top of `collect`, `collectMatchups`, `collectScores`, `livePoints`, `leagueSchedule`,
  `leagueTeams`, `leagueTradeCounts`, `leagueTransactions`, `leagueWaivers`, `leagueDraft`), so a new league reader is
  covered by being written there rather than by every caller remembering. Guarding the callers instead is how the
  Trade tab broke on a fresh load: `leagueTeams` had been missed. A Sleeper-only account downloads none of the three,
  and the newsletter file loads on idle after the first render.
- Inter is `font-display: optional` (v1.89.0), not `swap`: the browser uses it only if it is already there, so a first
  visit draws immediately in the system font at `font-size-adjust` 0.5, which is Inter's x-height, and never reflows
  partway through being read; every visit after is Inter from the cache. Note what it does **not** do: the file is
  still fetched, so this bought rendering, not bandwidth.
- Hosting sends security headers on every response (`firebase.json`: nosniff, frame denial, referrer
  policy, permissions policy, HSTS) and, since v1.44.0, a Content-Security-Policy in **report-only** mode:
  nothing is blocked, browsers post what the policy would have blocked to `/api/csp` (`cspReport`, logged at
  info). The policy lists Firebase's and Sleeper's, ESPN's, Kit's and Cloudflare's hosts and a sha256 hash for
  each inline script (the theme snippet on every page, the website's forward, the app's boot script). Changing an
  inline script changes its hash: recompute (the hashes are the base64 sha256 of the text between the script
  tags) and update the header, or the logs fill with reports. Enforce it only after a few weeks of clean logs.
- The owner's briefing (`ownerBriefing`, v1.45.0): a Firestore trigger on `lab/{doc}`; when titan-analytics posts
  `value-latest` or `dump-latest`, `briefingFor` (pure, tested) writes one push (the counts and the top sells, buys
  and claims, or starts and pickups) and `deliver` sends it to the owner's devices (the account with the
  `titanOwner` claim, `ownerUid`), keyed `brief|week|value` or `brief|week|dump` so a re-post says nothing new.
  Two things cost an evening on 2026-09-15, both worth knowing for any new event trigger. The first deploy failed
  while Eventarc's service agent permissions were still propagating; the retry created the function but left the
  Cloud Run service without `roles/run.invoker` for the compute service account, so Pub/Sub could not call it and
  every event was dropped with nothing logged anywhere (the owner granted it; a redeploy keeps it). And Firestore
  fires no event for a write that leaves the document unchanged, so re-posting the same report file is silent: to
  test, rebuild the report (a new `at`) and then upload. Every way out of the handler now logs why.
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
