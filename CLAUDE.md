# Titan Fantasy Football Manager: working notes for Claude

A static web app (no build step, no dependencies) plus two Firebase Cloud Functions. Live at
https://titanfantasyfootball.com (Porkbun domain on Firebase Hosting; also served, and kept, at
https://titan-fantasy-football.web.app, which the Android app is tied to; never redirect it)
(Firebase project `titan-fantasy-football`, Blaze plan);
code at github.com/clintonburnell-cmd/titan-fantasy-football. The Google Play app is a Trusted Web
Activity kept outside this repo (`D:\Claude\titan-android`, with `PLAY-LISTING.md`); it loads the
live site, so site changes reach it without a new upload. What's done and what's next lives in
`README.md` (Roadmap, Save points), not here.

## Where things are

| File | What it does |
|---|---|
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
- Default rankings (`defaultRanks`, `rankingsBy` in `engine.js`) are Sleeper's weekly projections
  in each league's scoring. A week's import wins; the defaults fill positions it leaves out, or
  everything when nothing is imported. The app (`ranksFor`, `analyze`, Results, `keepStarted`)
  and the server job (`freezeForUser`) follow the same rule: change them together.
- Rosters follow Sleeper's order: `L.rows` for starters, then the bench by `POS_ORDER`,
  then Reserve (IR and taxi, `heldAs`). Keep new roster views in that order.
- Show new ESPN or Yahoo features only once they work; don't promise them in the app or the listing.

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
