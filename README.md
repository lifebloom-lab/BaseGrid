# BaseGrid

A small Last War alliance placement planner. The placement engine is client-side, with no dependencies or build step. Optional roster imports use LastWarTools through a small Python relay.

## Run locally

From this folder, start BaseGrid with Python 3 (no packages to install):

```sh
python3 server.py
```

Open <http://127.0.0.1:8000>. Stop the server with Ctrl+C. Use an HTTP server instead of opening `index.html` directly: browsers restrict JavaScript modules on `file://` URLs.

For manual placement only, the original `python3 -m http.server 8000 --bind 127.0.0.1` still works. API imports need `server.py` because LastWarTools currently rejects the browser's cross-origin preflight requests. If using a plain static host, the import form explains that its relay is unavailable.

To use the app on a phone on the same trusted Wi-Fi network, run `python3 server.py --host 0.0.0.0` and open `http://YOUR_COMPUTER_LAN_IP:8000` on the phone. This exposes the app and relay to that network; stop the server when finished. The development server uses HTTP, so use localhost or an HTTPS deployment when entering a private API key. The server serves only the app's assets, not Git files, environment files, or directory listings.

## Use

1. Enter names in placement order, one per line, an origin X/Y, and spacing `p`.
   Before starting, drag any preview box onto an empty tile, including beyond the original rectangle on any side. The player keeps that position and leaves a gap behind. Dropping onto another player swaps their positions. A new empty border appears after each move; **＋ More space** extends the available map on every side. On touch screens, drag the ⠿ handle; the rest of the card still allows scrolling. With a keyboard, focus a handle, press Space or Enter to pick it up, use arrows (or Home/End), then Space or Enter to drop. Escape cancels. Dropping outside the map cancels the move.
2. Start placement. **Placed** confirms that player's slot. **Obstacle** records a blocked slot and proposes the next position to the same player.
3. **Undo last action** reverses either action, including after completion or a refresh. Repeat to undo further.
4. The map distinguishes placed, blocked, current, and upcoming slots. Wide maps scroll horizontally without changing column alignment. The log includes all confirmed coordinates and marked obstacles.
5. **Reset** clears the saved session after confirmation and retains the setup fields on screen. **Clear saved session** on the setup screen also clears those fields.

During placement, **Message to player** suggests a message containing the current player's name and proposed X/Y coordinates. Choose a small flag for English, Spanish, Brazilian Portuguese, French, Korean, German, Japanese, or Simplified Chinese, then **Copy message** and paste it into your own chat. Language names are available to screen readers and on hover; the selected name appears above the flags. Messages update with placement, obstacle skips, and undo. Copying does not mark the player as placed or send anything. If clipboard access is unavailable, the message is selected for manual copying.

Translations are built in and require no API calls. Your chosen message language is saved separately in this browser, so reloads and resetting or clearing a plan retain it. Older workspaces default to English. The planner interface itself stays in English.

Moving players updates their coordinates immediately and saves the draft locally, including player IDs, HQ levels, and groups. Players with identical names retain their distinct records. It uses no API calls and does not alter the saved source roster. Position editing is available before placement starts; placement follows the names list while respecting each player's chosen position. Edit the names list to change the processing order. New players fill free default positions, while matched players keep their saved positions.

To reserve a blocked tile before starting, drag **✕ Obstacle** onto an empty or player tile, or click/tap **✕ Obstacle** and then choose the tile. If a player occupies the target, that player moves to a free position while other assignments stay fixed. Moving an existing obstacle onto a player swaps their positions. Obstacles can be placed outside the original rectangle and removed using **Remove**. The same keyboard pickup/arrow/drop controls work for obstacles. Dropping outside the map or pressing Escape cancels. Positions are saved with the local plan without API calls.

When placement starts, preplanned obstacles are avoided and included in the map and coordinate log. **Obstacle** during placement handles newly discovered blocks. In a custom formation, it proposes the next free position for the affected player without taking another player's reserved tile; other assignments and intentional gaps remain. **Undo last action** reverses the last placement or block and restores its proposal. Reset returns to the editable preview. Chosen grid positions are relative to the origin and spacing; changing those setup values changes their game coordinates.

## Import alliance players

1. On the setup screen, click **Import players**.
2. Enter your [LastWarTools API key](https://lastwar.tools/) and server number, then click **Find alliances**.
3. Select your alliance and click **Load players**. The API lists up to 200 ranked alliances per server. If yours is missing, use **Have an alliance ID instead?** and enter its 32-character ID from LastWarTools; that route does not need a server number.
4. Review the roster, select power or alphabetical order, then click **Use … players**. Only this last step replaces the current roster. Closing the dialog, errors, and cancelled requests leave it unchanged.
5. Edit names or reorder lines as needed, then start placement. Matching imported names retain their player IDs and metadata, including after refresh; newly entered names become manual records. Duplicate names are matched in their original occurrence order.

Successful alliance searches and rosters are saved immediately in a separate local library, even before you click **Use … players**. Next time, the import dialog opens your most recently saved roster without asking for a key or calling the API. Choose another entry under **Saved roster** to reuse it. HQ levels, groups, power, and player IDs are retained. Resetting or clearing a formation does not erase this library. Existing imported players are copied into the library as **Previous import** when upgrading.

The import preview and the planner show the source **server number** and **alliance name/tag**. This context stays visible during placement and after reload, and is saved with each roster. Earlier imports recover context from an unambiguous saved alliance search where possible, without API calls. Direct-ID imports show the alliance ID and mark missing server/name information as not provided; member home servers are not used to guess the source server.

Normal searches and **Load players** always use saved results if available, with no expiry or background refresh. A first lookup costs one API call; only **Refresh players · 1 API call** or **Refresh alliances · 1 API call** downloads a newer copy of existing data. The dialog shows when data was saved. Failed refreshes keep the previous copy. API keys are never cached. If local storage fails, a notice explains that the data is only kept for this visit.

LastWarTools is an independent community provider. Its requests use your provider allowance and shared game-connection queue, so availability and response time vary. The app uses read-only roster endpoints; it does not ask for your game password or captured game-session files. API keys are held only while the dialog is open, sent through the same-origin relay to `https://api.lastwar.tools`, and cleared on close. BaseGrid does not save keys to localStorage, files, URLs, or logs. Saved data includes the imported roster, not the key.

`lastwar-api.js` maps the provider's documented responses to player records and rejects incomplete/invalid rosters. Each imported player carries `hqLevel` (a positive integer or `null`) and `group` (the provider's rank code 1–5 or `null`), plus the original numeric `rank` for reference. HQ levels above 30 are supported. Missing/invalid levels and groups are shown as unknown; they are never replaced with zero or a guessed group. These details appear in the import review, formation, current player, and placement log, and survive sorting, reload, obstacles, and undo. Older saved imports are upgraded on load. Manual players can still be entered without these details.

Formation tiles abbreviate **Group 1–5** as **R1–R5**, keeping the provider's original numbers unchanged. The provider describes rank 1 as “R1 Leader” but does not document the complete mapping to game roles. Keep that mapping in the adapter once verified; do not use the numeric direction as a leadership priority yet. Placement continues to use roster order, leaving level/group placement rules for the next iteration.

`server.py` accepts only the two documented read operations, fixes the upstream host, refuses redirects and cross-origin browser calls, and does not cache responses. It is a local development relay, not a production hosting service.

API contract: [LastWarTools documentation](https://api.lastwar.tools/docs) and [OpenAPI schema](https://api.lastwar.tools/openapi.json). Import tests use fixture responses; a successful authenticated live import still needs your API key.

Drafts, actions, and the roster library are saved automatically in this browser's localStorage. They stay on the same device/browser/origin; they do not sync between your computer and phone. Always use the same address (for example, `http://127.0.0.1:8000`); `localhost`, a different port, and `file://` do not share its storage. If storage is unavailable or full, a notice explains that the current plan may not survive refresh. Clearing browser data removes both the plan and the roster library. Only one plan per browser origin is supported; use one tab to avoid overwriting another tab's work.

## Files

```text
index.html               Accessible page structure
styles.css               Responsive interface and formation grid
ui.js                    Events, rendering, and persistence feedback
placement.js             Pure session transitions and coordinates
players.js               Manual-input data adapter
storage.js               Versioned localStorage boundary
lastwar-api.js            Alliance/member API client and response validation
import-ui.js              Import dialog, request cancellation, roster review
roster-cache.js           Local roster/search library; explicit refresh only
reorder-ui.js             Mouse/touch dragging and accessible keyboard reordering
free-formation.js         Signed grid positions, swaps, collisions, and expandable preview
placement-messages.js     Translated placement messages, language preference, and copying
server.py                 Static server and read-only API relay (Python stdlib)
tests/placement.test.js  Engine and input-adapter tests
tests/storage.test.js    Persistence and reset tests
tests/lastwar-api.test.js API client, errors, sorting, and imported records
tests/roster-cache.test.js Reuse without API calls, refresh, persistence, failures
tests/reorder.test.js      Reordering, duplicate identities, persistence, coordinates
tests/planned-obstacles.test.js Reserved tiles, automatic skips, undo, and persistence
tests/test_server.py      Relay, response handling, and HTTP boundary tests
package.json             Node test command; no dependencies
```

## Placement model

`createSession` accepts player records (`{ id?, name, ...metadata }`), `x0`, `y0`, and `spacing`. Names are required; duplicates are allowed, with distinct IDs. Manual input is converted into records by `parseManualPlayers`. Other sources can later supply records through the same boundary. Metadata is preserved, but ranks do not influence this version.

The default rectangle has `ceil(sqrt(playerCount))` columns. For slot `i`, column is `i % columns`, row is `floor(i / columns)`, and each axis advances by `3 + spacing`. Default sessions continue to use the original row-major placement rules. Dragging captures a custom `layout` with signed `{column, row}` positions keyed by player ID, plus obstacle positions. These are independent of the visible canvas bounds and may extend in any direction. `slotToCoordinate` and `tileToCoordinate` interpret the origin as the base reference point. The visual cells represent whole bases, not individual map tiles.

Custom sessions reserve every pending player's target and avoid both planned and newly recorded obstacles. An obstructed player scans forward to a free tile within the formation's column bounds, adding rows when needed; other players keep their positions. Snapshots store the initial custom layout and replay actions deterministically, including after reload or undo. Older rectangular drafts and sessions remain supported. The preview adds empty drop targets around the occupied area; sparse, very wide saved layouts avoid allocating every empty cell.

Each consumed slot is an explicit `player` or `obstacle` occupant containing its slot index and coordinates. The occupant list also records undo history. `plannedObstacles` stores sorted, unique non-negative tile indices; automatic skips append obstacles marked `automatic: true`. Undo reverses the latest manual action and its subsequent automatic skips together. Upcoming player positions are projections. All planned obstacles remain visible even if a shorter roster no longer reaches them. Transitions return new state and do not mutate the previous session. Obstacles advance only the slot; players advance both indices. Multi-pass rank placement is not implemented yet.

Saved sessions contain versioned setup inputs, planned obstacle indices, and manual action types. Loading replays validated actions and automatic skips to reconstruct explicit occupants, fixed columns, indices, and undo history. Older snapshots default to no planned obstacles. Invalid saved data is reported instead of used. Initial X/Y accept safe whole numbers (including zero and negative coordinates); spacing is a non-negative whole number. No game-specific map bounds are assumed. Unsafe coordinate arithmetic is rejected.

## Tests

With Node.js 20 or later:

```sh
node --test
```

`npm test` is equivalent; there is nothing to install. Tests cover ordinary and obstructed placement, fixed columns and added rows, several spacing values, undo, invalid input, one/square/non-square player counts, determinism, immutability, saved-session restoration, and API imports.

Run the Python relay tests separately (they open a temporary loopback server and never call the live API):

```sh
python3 -m unittest discover -s tests -p 'test_*.py'
```

## Deploy later

Publish `index.html`, `styles.css`, `ui.js`, `placement.js`, `players.js`, `storage.js`, `import-ui.js`, `roster-cache.js`, `reorder-ui.js`, `placement-messages.js`, `free-formation.js`, and `lastwar-api.js` together. Manual planning and reuse of saved rosters work as a static site, including a GitHub Pages project path. Fetching new data additionally needs the same-origin `/api/lastwar/…` relay, which GitHub Pages cannot run. An HTTPS production deployment could implement the same two routes using a serverless function. This project has not been published.
