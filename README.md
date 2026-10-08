# BaseGrid

A small Last War alliance placement planner. The placement engine runs in the browser without runtime dependencies. Optional roster imports use LastWarTools through a same-origin relay: Python for local use, or a Cloudflare Worker for hosting.

## Run locally

From this folder, start BaseGrid with Python 3 (no packages to install):

```sh
python3 server.py
```

Open <http://127.0.0.1:8000>. Stop the server with Ctrl+C. Use an HTTP server instead of opening `index.html` directly: browsers restrict JavaScript modules on `file://` URLs.

For manual placement only, the original `python3 -m http.server 8000 --bind 127.0.0.1` still works. API imports need `server.py` because LastWarTools currently rejects the browser's cross-origin preflight requests. If using a plain static host, the import form explains that its relay is unavailable.

To use the app on a phone on the same trusted Wi-Fi network, run `python3 server.py --host 0.0.0.0` and open `http://YOUR_COMPUTER_LAN_IP:8000` on the phone. This exposes the app and relay to that network; stop the server when finished. The development server uses HTTP, so use localhost or an HTTPS deployment when entering a private API key. The server serves only the app's assets, not Git files, environment files, or directory listings.

## Use

With no roster, **Get started** offers **Enter player names** or **Import players**. The manual option focuses the name field; the import option opens the same import wizard as the setup panel. Cancelling import returns to the starting view. Manual entry stays selected after a refresh, and saved plans resume directly. Once players are in the pool, a short prompt explains starting coordinates and placement. Saved rosters are advertised on the welcome panel and can be reused without a key or API calls.

1. Enter player names, one per line, plus initial X/Y and spacing, or import a saved alliance roster. Initial X/Y is the center tile of the first base: a base at (412, 687) occupies X 411–413 and Y 686–688. Tile labels, drag previews, messages, and confirmations all use center coordinates.
2. New players enter the **Base pool**. Choose a player and drag **Add base** onto an empty area, or click it and then choose an area. **Auto place** asks whether to place only the pool or rearrange all unconfirmed bases, including the pool. Both choices start at initial X/Y, use spacing, and skip obstacles and bases that stay fixed. Existing saved formations keep their positions.
3. Drag bases one tile at a time to shape the formation. Each base occupies 3 × 3 tiles. Drop onto another unconfirmed base to swap their exact positions; the preview names the player you will swap with. Confirmed bases stay locked, and obstacles cannot be swapped. A green footprint fits or swaps; a red footprint is blocked. Empty tiles stay empty, including outside the original rectangle. **＋ More space** extends the map. Use **↶** on an unconfirmed base to return it to the pool, clearing its placement progress while retaining the player’s name, HQ level, and rank. Reinsert it whenever you want; undo a confirmation first to return a confirmed base.
4. Choose **Place** on any player's tile. The side panel shows their coordinates and a suggested message. Select a language flag, then **Copy message** and paste it into your chat.
5. When the player actually arrives, select **Player has moved here**. Their tile becomes green and locks. Other bases remain movable.
6. Use **Continue** for a player in progress, or **View** on a placed base to review it and **Undo confirmation**. Several players can be in progress at once.

Choose **Full screen** in the Formation header to fill the browser window with the map and its tools. Dragging, obstacles, and local saving work in this view. Place, Continue, and View open the player's message and placement status in a pop-up over the map. Copy a translated message, confirm arrival, or undo confirmation without leaving full screen. **Back to map** or Escape closes the pop-up and returns to the same map position. **Exit full screen** or Escape from the map returns to the normal layout; if a move is active, the first Escape cancels that move.

Use **Find a player** below Player names to filter by any part of a name, ignoring capitals and accents. Results show HQ, rank, and map coordinates or pool status. Select a result to center and highlight its base at 100% zoom, or select an unassigned player in the base pool. Enter locates the first match; **×** or Escape clears the search. Search works with confirmed bases and uses only the current roster, without changing names, positions, or placement status or making API calls.

On phones, full screen uses a compact progress header and **Bases**, **Obstacles**, and **More** controls. The toolbar moves to the side in landscape. **Bases** opens a searchable pool ordered by rank and HQ, with the existing **Auto place** option. Choose a player, then tap the map to add their base. **Obstacles** keeps the chosen size active for repeated placement until **Done**. Swiping pans without dropping an item; tapping a base opens its message, while dragging its handle moves it. **More** contains map expansion, the legend, and help. Panels preserve the map's scroll position and close with their close button or Escape.

**Map zoom:** use **−** and **+** to move between an overview and close-up details. **Fit** shows the map within the available space; click the percentage to return to **100%**. Full-size tiles show coordinates and placement controls; compact tiles show names, HQ levels, and rank badges. Further out, markers retain rank colors and placement status, dropping text when it cannot fit. Tap a compact tile or marker to zoom in on it without starting placement. Zoom works in normal and full-screen views, is remembered in this browser, and never changes coordinates or spacing. Changing zoom cancels an active move.

Planned tiles are neutral, in-progress tiles are blue, and confirmed tiles are green. Obstacles are amber with diagonal stripes. The counts above the map track each state. R labels use consistent colored badges on tiles, in the player panel, and in confirmed coordinates: R1 slate, R2 teal, R3 blue, R4 purple, and R5 gold. Missing groups remain labeled unknown. Copying does not confirm a placement or send a message. If you move a base after copying its message, the tile and side panel remind you to copy the updated coordinates. Other players keep their positions and copy status.

Messages support English, Spanish, Brazilian Portuguese, French, Korean, German, Japanese, and Simplified Chinese. Language names appear on hover and are available to screen readers. Translations are built in and use no API calls. The selected language persists separately from the plan. If clipboard access is unavailable, select and copy the message manually.

On touch screens, drag the ⠿ handle; the rest of each card allows scrolling. With a keyboard, focus a handle, press Space or Enter, use arrow keys (or Home/End), then Space or Enter to drop. Escape or dropping outside the map cancels. Confirmed tiles cannot be moved or used as drop destinations.

Choose **✕ Obstacle 1 × 1** for a small blocker or **✕ Obstacle 3 × 3** for a larger one. Drag it onto an empty area, or click the button and then choose an area. The entire footprint must be clear; obstacles never displace players. They can extend beyond the original rectangle and be moved or removed with **Remove** (× on a small obstacle). Keyboard movement also works for both sizes.

**Back to setup** closes the player panel without changing their status. **Back to planned** cancels an unconfirmed placement. **Reset placement progress** unlocks all bases and clears their progress while retaining the roster, positions, and obstacles. **Clear formation** removes the current plan and returns to Get started; saved API rosters and language preferences remain available. Both resets require confirmation.

Positions, per-player progress, copied coordinates, selection, player IDs, HQ levels, and groups save locally without API calls. Confirmed bases prevent roster replacement and changes to the origin or spacing; undo confirmations or reset progress before changing those settings. Older saved plans and sequential sessions upgrade automatically, preserving actual X/Y coordinates, confirmed positions, and copied messages. Existing obstacles become 3 × 3 footprints.

## Import alliance players

1. On the setup screen, click **Import players**.
2. **Server:** enter your server number and [LastWarTools API key](https://lastwar.tools/), then click **Find alliances**. Saved searches need no key. The note above the button shows whether the lookup uses an API call.
3. **Alliance:** choose your alliance, then **Load players** appears with its lookup cost. If yours is missing, expand **Can’t find your alliance?** to refresh the list or enter its 32-character ID. The API lists up to 200 ranked alliances per server.
4. **Review:** check the server, alliance, and player count. Expand **View … players** to inspect names, levels, ranks, or change placement order. Click **Add … players** to import them into the base pool. Only this last step replaces the current roster. Back and Change links preserve inputs without starting requests; errors and cancellation leave the current roster unchanged.
5. Edit names or reorder lines as needed, then add bases from the pool or use Auto place. Matching imported names retain their player IDs and metadata, including after refresh; newly entered names become manual records. Duplicate names are matched in their original occurrence order.

Successful alliance searches and rosters are saved immediately in a separate local library, even before you click **Add … players**. Returning users choose a **Saved roster** and go straight to Review without an API key or API calls, or choose **Find an alliance** to start a new search. HQ levels, groups, power, and player IDs are retained. Resetting or clearing a formation does not erase this library. Existing imported players are copied into the library as **Previous import** when upgrading.

The import preview and the planner show the source **server number** and **alliance name/tag**. This context stays visible during placement and after reload, and is saved with each roster. Earlier imports recover context from an unambiguous saved alliance search where possible, without API calls. Direct-ID imports show the alliance ID and mark missing server/name information as not provided; member home servers are not used to guess the source server.

Normal searches and **Load players** always use saved results if available, with no expiry or background refresh. A first lookup costs one API call; only **Refresh players · 1 API call** or **Refresh alliances · 1 API call** downloads a newer copy of existing data. The dialog shows when data was saved. Failed refreshes keep the previous copy. API keys are never cached. If local storage fails, a notice explains that the data is only kept for this visit.

LastWarTools is an independent community provider. Its requests use your provider allowance and shared game-connection queue, so availability and response time vary. The app uses read-only roster endpoints; it does not ask for your game password or captured game-session files. API keys are held only while the dialog is open, sent through the same-origin relay to `https://api.lastwar.tools`, and cleared on close. BaseGrid does not save keys to localStorage, files, URLs, or logs. Saved data includes the imported roster, not the key.

`lastwar-api.js` maps the provider's documented responses to player records and rejects incomplete/invalid rosters. Each imported player carries `hqLevel` (a positive integer or `null`) and `group` (the provider's rank code 1–5 or `null`), plus the original numeric `rank` for reference. HQ levels above 30 are supported. Missing/invalid levels and groups are shown as unknown; they are never replaced with zero or a guessed group. These details appear in the import review, formation, current player, and placement log, and survive sorting, reload, obstacles, and undo. Older saved imports are upgraded on load. Manual players can still be entered without these details.

Formation tiles abbreviate **Group 1–5** as **R1–R5**, keeping the provider's original numbers unchanged. The provider describes rank 1 as “R1 Leader” but does not document the complete mapping to game roles. Keep that mapping in the adapter once verified; do not use the numeric direction as a leadership priority yet. The initial layout uses roster order; players can then be moved and confirmed in any order. Automatic level/group placement rules are not implemented.

`server.py` accepts only the two documented read operations, fixes the upstream host, refuses redirects and cross-origin browser calls, and does not cache responses. It is a local development relay, not a production hosting service.

API contract: [LastWarTools documentation](https://api.lastwar.tools/docs) and [OpenAPI schema](https://api.lastwar.tools/openapi.json). Import tests use fixture responses; a successful authenticated live import still needs your API key.

Drafts, actions, and the roster library are saved automatically in this browser's localStorage. They stay on the same device/browser/origin; they do not sync between your computer and phone. Always use the same address (for example, `http://127.0.0.1:8000`); `localhost`, a different port, and `file://` do not share its storage. If storage is unavailable or full, a notice explains that the current plan may not survive refresh. Clearing browser data removes both the plan and the roster library. Only one plan per browser origin is supported; use one tab to avoid overwriting another tab's work.

## Files

```text
index.html               Accessible page structure
styles.css               Responsive interface and formation grid
ui.js                    Events, rendering, and persistence feedback
placement.js             Coordinates and legacy session migration support
tile-placement.js        Independent player progress, confirmations, locks, and migration
players.js               Manual-input data adapter
storage.js               Versioned localStorage boundary
lastwar-api.js            Alliance/member API client and response validation
import-ui.js              Import dialog, request cancellation, roster review
roster-cache.js           Local roster/search library; explicit refresh only
reorder-ui.js             Mouse/touch dragging and accessible keyboard reordering
map-zoom.js               Map scale, adaptive detail, fit, and anchored zoom
grid-layout.js           Unit grid, footprint collisions, obstacle sizes, and canvas bounds
free-formation.js         Legacy coarse-slot layout support for saved-plan migration
placement-messages.js     Translated placement messages, language preference, and copying
server.py                 Static server and read-only API relay (Python stdlib)
worker.js                 Cloudflare read-only API relay and asset binding
wrangler.jsonc            Cloudflare deployment configuration
scripts/build.mjs         Copies only public app assets into dist/
tests/worker.test.js      Cloudflare routes, client integration, errors, and request limits
tests/tile-placement.test.js Independent placement, locks, copy warnings, migration, and persistence
tests/grid-layout.test.js Unit snapping, footprint collisions, both obstacle sizes, and saved-plan upgrades
tests/placement.test.js  Legacy engine and input-adapter tests
tests/storage.test.js    Persistence and reset tests
tests/lastwar-api.test.js API client, errors, sorting, and imported records
tests/roster-cache.test.js Reuse without API calls, refresh, persistence, failures
tests/reorder.test.js      Reordering, duplicate identities, persistence, coordinates
tests/planned-obstacles.test.js Reserved tiles, automatic skips, undo, and persistence
tests/test_server.py      Relay, response handling, and HTTP boundary tests
package.json             Test/build commands and Wrangler deployment tool
```

## Placement model

Auto place uses `ceil(sqrt(playerCount))` base columns with `spacing` empty cells between 3 × 3 bases. Layout version 2 stores signed `{column, row}` offsets for footprint corners relative to the first base's corner, keyed by player ID; obstacles additionally store `size: 1 | 3`. New saves set `explicit: true`: roster members without a layout position remain in the pool. Older layouts retain their automatic positions until an edit freezes them. The origin is the first base's center, so cell (0, 0) is at (origin.x − 1, origin.y − 1). Reported X/Y identifies the center of each footprint, including both obstacle sizes. Changing spacing affects subsequent Auto place operations without rescaling existing positions. Manual moves always snap to one coordinate. Pool membership and all player metadata survive reload without API calls.

Collision checks compare full square footprints and allow edge contact and a moving object's own previous area. Dropping a base onto another unconfirmed base exchanges their exact positions; no other occupant moves. A pointer over a base snaps the swap preview to that base; keyboard movement offers a swap when the candidate center enters it. Partial overlaps without a swap target remain blocked. Status, rank, and HQ remain attached to each player, and copied messages become stale for both swapped players. Pointer and keyboard previews use the same validation as committed moves. The canvas renders only occupants and a drop preview over a subtle CSS grid, so empty map cells do not create thousands of DOM nodes.

`tile-placement.js` stores independent records for players in progress or placed; absence of a record means Planned. Starting placement captures the formation's current positions. Confirming stores the exact X/Y as a lock. All moves, obstacle edits, and setup edits preserve confirmed coordinates. Undo affects only the selected player.

Copy records store the actual coordinates, name, and language copied. Comparing them with the current tile detects stale messages, including when an asynchronous clipboard write finishes after a move. Copying never confirms arrival.

The workspace retains its versioned local storage format. Legacy sequential sessions are read by `placement.js` and migrated into explicit positions and independent confirmations. Earlier coarse-slot layouts are converted using their actual coordinates, with obstacles upgraded to size 3; a layout version marker prevents repeated conversion. The workspace storage key stays the same, so existing browser data remains available. Its original action replay and tests remain for backward compatibility. New saves use draft layout and tile placement records with no sequential session.

Initial X/Y accept safe whole numbers, including zero and negatives; spacing must be a non-negative whole number. Unsafe arithmetic and overlapping positions are rejected. No game-specific map bounds are assumed. Player metadata is retained without interpreting rank codes as placement priority.

## Tests

With Node.js 22 or later:

```sh
node --test
```

`npm test` is equivalent; tests need no installed packages. Tests cover ordinary and obstructed placement, fixed columns and added rows, several spacing values, undo, invalid input, one/square/non-square player counts, determinism, immutability, saved-session restoration, and API imports. Worker tests use sample provider responses and verify that HQ levels and groups pass through the existing client. They also check allowed routes, origin checks, redirects, response-size limits, cancellation, timeouts, and sanitized errors without spending API credits.

Run the Python relay tests separately (they open a temporary loopback server and never call the live API):

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

## Deploy on Cloudflare Workers Free

The repository is ready for a **Worker with Static Assets**. It hosts the planner and import relay at one HTTPS address. No Python service, database, custom domain, or LastWarTools key in Cloudflare settings is needed. Keep the account on **Workers Free**.

1. In the [Cloudflare dashboard](https://dash.cloudflare.com/), open **Workers & Pages → Create application → Import a repository**.
2. Connect GitHub, grant access to **lifebloom-lab/BaseGrid**, and select that repository.
3. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Project / Worker name | `basegrid` (lowercase, matching `wrangler.jsonc`) |
   | Production branch | `main` |
   | Root directory | Repository root; leave blank or use `/` |
   | Build command | `node scripts/build.mjs` |
   | Deploy command | `npx wrangler deploy` |
   | Environment variables / secrets | None |

4. Select **Save and Deploy**, then open the provided `https://basegrid.<your-subdomain>.workers.dev` address.

Use Workers, including the Worker script, so `/api/lastwar/…` is available. A static-only upload or GitHub Pages cannot run the import relay. Cloudflare installs the pinned deployment tool from this repository. The explicit build command is needed for the dashboard build pipeline; `wrangler.jsonc` also runs the build for local Wrangler commands.

The build copies only the 16 public app files into `dist/`. Python code, tests, Git files, and environment files are excluded. API responses are never cached; the relay only forwards the two supported GET routes to `https://api.lastwar.tools`, refuses redirects, bounds provider responses to 2 MiB, and times out after 90 seconds. It uses the key entered by the visitor for that request only. Persistent Worker logs are disabled in the configuration, and the relay never logs request headers or bodies.

Saved plans and rosters remain in the visitor's browser. The Cloudflare address has its own storage: existing localhost data does not automatically move to the hosted app. Use the same hosted address consistently to reuse its saved rosters without calling the API again.

The [Workers Free limits](https://developers.cloudflare.com/workers/platform/limits/) currently include 100,000 Worker requests per day across the account and 10 ms CPU time per request. Time waiting for LastWarTools does not count as CPU time. [Static assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) are served separately without invoking the Worker for matching files. Cloudflare hosting does not change LastWarTools' own API allowance.

For a local Cloudflare preview, install Node.js 22+ and the pinned pnpm version, then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

To validate the deployment package without publishing, run `pnpm exec wrangler deploy --dry-run`. For a manual deployment after Cloudflare login, run `pnpm run deploy`. The Python local workflow above remains available without installing Node packages.

Cloudflare documentation: [GitHub deployment setup](https://developers.cloudflare.com/workers/ci-cd/builds/) and [build settings](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
