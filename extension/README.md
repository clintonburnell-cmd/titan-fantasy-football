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
  picks are typed.
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
