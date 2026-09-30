# BaseGrid

A small, client-side Last War alliance placement planner. No dependencies, build step, backend, or game API connection.

## Run locally

From this folder, start any static HTTP server. For example, with Python 3:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

Open <http://127.0.0.1:8000>. Stop the server with Ctrl+C. Use an HTTP server instead of opening `index.html` directly: browsers restrict JavaScript modules on `file://` URLs.

To use the app on a phone on the same trusted Wi-Fi network, run `python3 -m http.server 8000 --bind 0.0.0.0` and open `http://YOUR_COMPUTER_LAN_IP:8000` on the phone. That serves this folder to your local network; stop the server when finished. Alternatively, deploy the static files to GitHub Pages or Cloudflare Pages without a build command.

## Use

1. Enter names in placement order, one per line, an origin X/Y, and spacing `p`.
2. Start placement. **Placed** confirms that player's slot. **Obstacle** records a blocked slot and proposes the next position to the same player.
3. **Undo last action** reverses either action, including after completion or a refresh. Repeat to undo further.
4. The map distinguishes placed, blocked, current, and upcoming slots. Wide maps scroll horizontally without changing column alignment. The log includes all confirmed coordinates and marked obstacles.
5. **Reset** clears the saved session after confirmation and retains the setup fields on screen. **Clear saved session** on the setup screen also clears those fields.

Drafts and actions are saved automatically in this browser's localStorage. They stay on the same device/browser/origin; they do not sync between your computer and phone. If storage is unavailable or full, a notice explains that the current plan may not survive refresh. Clearing browser data removes the plan. Only one plan per browser origin is supported; use one tab to avoid overwriting another tab's work.

## Files

```text
index.html               Accessible page structure
styles.css               Responsive interface and formation grid
ui.js                    Events, rendering, and persistence feedback
placement.js             Pure session transitions and coordinates
players.js               Manual-input data adapter
storage.js               Versioned localStorage boundary
tests/placement.test.js  Engine and input-adapter tests
tests/storage.test.js    Persistence and reset tests
package.json             Node test command; no dependencies
```

## Placement model

`createSession` accepts player records (`{ id?, name, ...metadata }`), `x0`, `y0`, and `spacing`. Names are required; duplicates are allowed, with distinct IDs. Manual input is converted into records by `parseManualPlayers`. Other sources can later supply records through the same boundary. Metadata is preserved, but ranks do not influence this version.

Columns are fixed once at `ceil(sqrt(playerCount))`. For slot `i`, column is `i % columns`, row is `floor(i / columns)`, and each axis advances by `3 + spacing`. **All coordinate interpretation is isolated in `slotToCoordinate`**, currently treating the supplied origin as the upper-left reference point. The visual cells represent whole bases, not individual map tiles.

Each consumed slot is an explicit `player` or `obstacle` occupant containing its slot index and coordinates. This append-only occupant list is also the undo history. Upcoming positions are projections and never become occupied until an action is taken. Transitions return new state and do not mutate the previous session. Obstacles advance only the slot; players advance both indices. No initial occupied-area or multi-pass rank placement is implemented yet.

Saved sessions contain versioned setup inputs and action types. Loading replays validated actions to reconstruct explicit occupants, fixed columns, indices, and undo history. Invalid saved data is reported instead of used. Initial X/Y accept safe whole numbers (including zero and negative coordinates); spacing is a non-negative whole number. No game-specific map bounds are assumed. Unsafe coordinate arithmetic is rejected.

## Tests

With Node.js 20 or later:

```sh
node --test
```

`npm test` is equivalent; there is nothing to install. Tests cover ordinary and obstructed placement, fixed columns and added rows, several spacing values, undo, invalid input, one/square/non-square player counts, determinism, immutability, and saved-session restoration.

## Deploy later

Publish `index.html`, `styles.css`, `ui.js`, `placement.js`, `players.js`, and `storage.js` together. All asset links are relative, including under a GitHub Pages project path. There is no build output or server runtime to deploy. This project has not been published.
