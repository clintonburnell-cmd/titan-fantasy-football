# Titan for Sleeper (Chrome extension, step 1)

Titan's calls on Sleeper's own pages, for Titan's owner. Loaded unpacked (no Web Store): the reports it shows are the
owner-only Value report and Data dump, read from his Titan account.

## What it does

- **Pills after player names** anywhere on sleeper.com: his edge on the market (the Value report's `vgap`), the call
  (buy low, sell high, keep, claim), a back's archetype, and on hover the projection, the market rank, the league's
  reason, the Late-Round note and the draft guide's take. Names match on the full name or "F. Last".
- **A panel on league pages** (`/leagues/<id>`): the Data dump's start ideas, the Value report's claims (with the
  drop it names and a bid when the league uses FAAB: `SCC.faabBid` on the league's winning bids, what's left of the
  owner's budget, how hot the pickup is on Sleeper's trending adds, and what he adds over the starter), the dump's
  pickups, buy-lows, sell-highs with keep/sell, the watch list, and the position note. Collapsible; remembers.
- **A trade check** in the panel: type the players you'd give and get (any player the Value report values in that
  league's format), and it totals each side's market value, what Titan says they're worth (the market's value moved by
  the projection's edge), and the points a game, with a verdict (even within 8%, or who wins by how much). It is the
  pieces' own numbers, not your lineup's change; the link opens Titan's Trade tab for that (lineup points, partners,
  what the other side would accept). Sleeper's own trade screen isn't read (its markup isn't documented), so the
  picks are typed. With both sides picked, "Send this trade to Titan's trade analyzer" opens Titan's Trade tab with
  the league and both sides filled in (`/app/trade?trade=<league>:<give ids>:<get ids>`; Titan finds the partner from
  the players you'd get).
- **Your lineup, by Titan's engine**, at the top of the panel: the service worker reads your Sleeper leagues the way
  Titan does (`sleeper.js`, `SleeperAPI.collect`: rosters, injuries, byes, matchups) and your synced weekly rankings
  (Firestore `users/{uid}/ranks`, this week's or the latest earlier; Titan's defaults from Sleeper's projections for
  positions you left out), then runs `SCC.analyzeAll`, the same call the app and the server job make. The section
  shows the recommended lineup by slot with each player's rank, the new starters marked, the changes your rankings
  want ("Start X (RB30) over Y"), hurt starters, and waiver upgrades (free agents ranked above one of your starters).
  Cached twenty minutes (`analysis` in storage); Refresh in the section or the popup reruns it. The Sleeper player list
  is kept between runs (`players`, three days). Only the Sleeper side of your account is read (no ESPN or Yahoo).
- **A game-day badge** on the icon: lineup changes your rankings want plus hurt starters across every league,
  recounted every twenty minutes (`titan-lineup` alarm) and on browser start. The popup's **Today** list names each
  league's lines: the changes with both players' ranks, hurt starters, waiver upgrades and the report's claims, each
  league a link to it on Sleeper (the same list as Titan's Today tab).
- **A nudge before kickoff** (v0.3.0): ninety minutes before a player's kickoff, if a lineup change or a hurt starter
  still stands in any league, one Chrome notification names the leagues and the moves ("Test League: Start X over Y at
  RB"), once per kickoff slot (`nudged` in storage); clicking it opens Titan's Lineups. `SCC.kickoffNudge` decides,
  checked after each analysis and every ten minutes (`titan-nudge` alarm). Kickoff times come from Titan's scores
  feed (`/api/scores`, ESPN's scoreboard through the server), read into the analysis too so the flex spots take the
  latest kickoffs as in the app; without it, a player's game day at 1 PM Eastern. Needs the `notifications`
  permission (in the manifest; Chrome asks nothing more).
- **A player card** on any pill (click): projection, points and over-usage, market rank against Titan's with the
  edge and value, usage (snaps, target share, routes, per-route), workload by position, this week's rank note and
  status, the league's call with its drop, the Late-Round note, the guide take, and a button that puts him in the
  trade check on the right side (you give when he's yours, you get when he's on another team). Escape or a click
  outside closes it.
- **A bid on every free agent's card**: `SCC.faabBid` on the league's winning bids and what's left of your budget,
  with what he adds over your lowest-projected starter at his position (from the lineup analysis).
- **Matchup** on league pages: both sides' projected finals and the chance to win (`SleeperAPI.collectMatchups` and
  `SCC.winProbability`, run in the worker with the lineup analysis; points so far once games start), then the
  lineup's close calls with both players' projections and rank notes and a favorite/underdog lean.
- **Propose on Sleeper**, assisted: with both sides picked, it names the partner (the team holding the players you'd
  get), copies "I give …; I get …" to the clipboard, and marks each player's pill give or get on Sleeper's pages
  until you press Done, so you can find them on Sleeper's trade screen. Titan never drives that screen itself: its
  markup is undocumented and automating it sits near Sleeper's terms.
- **Links into Titan** at the panel's foot: Lineups, Waivers and Value for the league on screen (`/app/<tab>?league=<id>`
  picks that league in Titan's dropdown). The panel's own Start section is the Data dump's start ideas and its Claims
  section the Value report's claims with a bid and a drop; the full recommended lineup and waiver plan (which need your
  imported rankings and every roster) stay in Titan.
- **The popup**: Connect to Titan, Refresh reports, Sign out, and switches for the pills and the panel.

It never writes to Sleeper (no lineups, claims or trades are submitted): step 2, composing a trade on Sleeper's
trade screen, waits until step 1 has been used, since it is fragile and near Sleeper's automation terms.

## How it signs in

Chrome extensions can't run Google's sign-in popup themselves, so Connect opens
`titanfantasyfootball.com/ext/connect.html?ext=<extension id>` (in `site/ext/`). That page signs in with Google the
way the app does and hands the Google credential to the extension with `chrome.runtime.sendMessage` (the manifest's
`externally_connectable` lists the site). The service worker (`bg.js`) turns it into the extension's own Firebase
session (`firebase/auth/web-extension`, kept in the extension's IndexedDB) and reads `lab/value-latest` and
`lab/dump-latest` over Firestore's REST API with the ID token; the rules let only the owner read `lab/`. Reports are
cached in `chrome.storage.local` and refreshed every six hours, on browser start, and from the popup.

## Build and load

```
cd extension
npm install
npm run build        # dist/firebase.js (the SDK, bundled by esbuild) and engine.js (copied from site/)
```

Then in Chrome: `chrome://extensions`, turn on Developer mode, Load unpacked, pick the `extension` folder. Click the
extension's icon, Connect to Titan, sign in on the page that opens, then open any Sleeper league. After a change to
the files, press the reload arrow on the extension's card. `dist/` and `engine.js` are committed so the folder loads
as is; rebuild after upgrading Firebase or changing `site/engine.js`.

## Files

| File | Does |
| --- | --- |
| `manifest.json` | MV3: the service worker, the content script on sleeper.com, the popup, the site under `externally_connectable` |
| `bg.js` | Session, report reads, Sleeper waiver facts (`league` message), refresh alarm |
| `content.js`, `content.css` | Pills and the panel (the panel lives in a shadow root so Sleeper's styles and ours don't mix) |
| `popup.html`, `popup.js` | Connect, refresh, sign out, switches |
| `src/firebase-ext.js` | The Firebase entry points bundled into `dist/firebase.js` |
| `engine.js` | A copy of `site/engine.js` (pure): `faabBid` for the bids |
| `icons/` | Titan's icon at 16, 48 and 128 |

Sleeper's page structure isn't documented and changes; the pills match text, not Sleeper's markup, so they survive
most changes. If a name is split across elements it won't get a pill.
