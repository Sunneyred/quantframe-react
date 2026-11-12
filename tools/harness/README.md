# Browser test harness

Runs the real frontend (the real `src/main.tsx`, router, contexts, pages and the station) in
headless Chromium against a mocked Tauri backend, and drives every screen and every station
function. Run it before each release:

```
python3 tools/harness/run.py
```

It exits 0 only when every step passed, no console error or page error occurred, no command hit
the mock without a handler, and no call broke the Rust contract. Screenshots of every step go to
`tools/harness/shots/` (or the folder given with `--shots`); look at them, a step can pass and
still look wrong.

Needs: the repo's `node_modules` (`pnpm install`), Python 3 with `playwright`
(`pip install playwright`), and a Chromium (`playwright install chromium`, or set
`HARNESS_CHROME=/path/to/chrome`). Nothing here is imported by the app or included in `dist/`.

## How it works

- `gen-contract.mjs` reads the Rust command signatures in `src-tauri/src/commands/**` and the
  handler list in `src-tauri/src/lib.rs`, and writes `contract.json`: every registered command
  with its argument names (camelCase, as Tauri expects them), which are required, and a coarse
  type. It runs at the start of every test run, so the contract follows the Rust source.
- `mock/tauri-mock.js` is injected into the page before the app boots (Playwright init script).
  It provides `window.__TAURI_INTERNALS__` (invoke, callbacks, events, `convertFileSrc`, window
  metadata) and answers every command with data shaped like the Rust structs: a logged-in user,
  the default settings, 12 stock items, 3 rivens, 4 wish list entries, 329 transactions, chats,
  orders, auctions, alerts, an inventory with about 46 priced item types, strategy status, and so
  on. Mutations change that state, so the UI round-trips (selling reduces stock, starting the
  trader emits its status event, ...).
  - A command that Rust does not register is rejected with Tauri's own "Command x not found".
  - A missing required argument or a wrong primitive type is rejected the way serde rejects it.
  - A plugin call that `src-tauri/capabilities/*.json` does not allow is rejected.
  - A registered command without a mock handler logs a loud console error and returns `null`.
  All four are collected and printed in the summary; the first, second and fourth fail the run.
- `window.__HARNESS__` (in the page) lets the test emit backend events: `emitMessage(event, data)`
  for the app's event bus, `emit(event, payload)` for raw Tauri events, and the shortcuts
  `chatMessage(...)`, `trade(...)`, `whisper(...)`, `ready()`.
- The asset protocol (`convertFileSrc`) is served from `src-tauri/resources/`, and the terms of
  service shown at start are the real `src-tauri/resources/tos.md`.
- `run.py` holds the scenarios; `lib.py` the plumbing (server, browser, error capture, steps).

A step fails on an exception, a failed check, any `console.error`, any uncaught error or
unhandled rejection, a failed request to the app, or a layout problem (a control that is cut
off, below the window with nothing to scroll, or covered by something else). Errors a step
provokes on purpose are allowed by pattern in that step only. The ignored noise is listed in
`lib.py` (`IGNORED`) and counted in the summary. Requests to other hosts are blocked (images are
answered with a 1x1 PNG) and counted.

## Scenarios

`--only <name>` runs one or more of them (repeat the flag).

| name | what |
| --- | --- |
| `boot` | start in the station / on Home, late backend start, login, terms of service, update dialog |
| `classic` | every classic route at 1280x800 through the side menu, with their tabs, the strategy panel, the settings dialog, backend events |
| `offline` | no inventory source: typed-in plat, AlecaFrame connect flow, the error when the file is missing |
| `station` | the station top-down: rooms, map travel to every entry, every terminal with the real page inside, lever, manager, docks, cards (sell, edit, hide, delete, bought, list for sale), stock list, palette, help, buyers from chat and whisper events, sales from trade events, classic view and back |
| `fp` | the same in first person |
| `remount` | leaving and re-entering the station several times: canvases and listeners must not pile up |
| `safety` | a page crashing inside a panel is contained; a crash of the station itself shows the way out, turns "open in the station" off and the app then opens in the classic view |
| `layout` | the classic routes and every station panel, card and overlay at the app's default window size (read from `src-tauri/tauri.conf.json`) |
| `small` | every station panel, card and overlay at 1280x800, with no alert showing (pages use different offsets then) |
| `game` | the 3D game (`/game`): walk from the Vault into the Market Observatory, focus a star with E, order book on the spire, an undercut, the Market Console (search, filters, stock card), an app modal routed onto the Comms display, third person, leaving for a lazy route |
| `audio` | the 3D game's sound, structurally (`scenarios_audio.py`): no context before a gesture, footsteps at stride rate, the tape deck and the master panel through E / Shift+E / wheel, persistence across a reload, sale / focus / undercut voices at their positions, context closed and nodes released over several remounts |
| `dist` | builds the production bundle (`pnpm build`) and runs a smoke pass on it: boot, routes, rooms, every terminal, lever, a sale, events (`--skip-build` uses the existing `dist/`) |

All but `dist` run on the Vite dev server, where the station exposes its game object
(`window.__vtStation`, dev builds only) so the test can walk up to a crate and press E.

`HARNESS_DEV_URL=http://127.0.0.1:5199` reuses a dev server that is already running.

## Reusing the mock backend (for example for the 3D game)

The mock is independent of the scenarios. To test new screens:

- Open a session with `Suite.open(width, height, options=..., storage=..., path="/game")` from
  `lib.py` (see `run.py` for examples). Everything the page calls through `@tauri-apps/api` is
  answered by the mock, and every call is recorded.
- `options` (passed to the mock): `loggedIn`, `tosAccepted`, `updateAvailable`, `started`
  (backend still starting until `__HARNESS__.ready()`), `alerts` (alert ticker on/off),
  `inventory` (`"connected"`, `"none"`: no AlecaFrame source, `"missing"`: source set but the file
  is missing), `platinum` (balance), `latency` (ms per call), `corrupt` (`"stock"` or `"orders"`:
  return a broken row, to test error boundaries).
- In the page, `window.__HARNESS__` exposes:
  - `state`: the whole mock database (settings, user, stockItems, stockRivens, wishList,
    transactions, chats, orders, auctions, owned inventory, ...); change it to set up a case;
  - `calls`, `counts`: every command with its arguments; `rejections`;
  - `unknown`, `notRegistered`, `contractErrors`, `extraArgs`, `denied`: the problem lists the
    summary prints;
  - `emit(event, payload)` (raw Tauri event), `emitMessage(event, data)` (the app's event bus,
    like `send_event!`), `emitUpdate(event, operation, data)` (like `send_event_update!`);
  - `chatMessage(chatIndex, text)`, `whisper(name)`, `trade(name, plat, "Sale"|"Purchase", item)`,
    `ready()`: realistic backend events (they also update the state first, like the backend);
  - `fail(command, error)`: the next call of that command rejects with `error`;
  - `listeners()`, `domListeners()`: listener counts, to prove a remount does not leak.
- New backend commands need no harness change for the contract: `gen-contract.mjs` picks them up
  from the Rust source. Add a handler to `commands` in `mock/tauri-mock.js`, or the call is
  reported as unknown and the run fails.
- `lib.py` `Suite.step(name, allow=[...])` fails a step on any console error, page error,
  unhandled rejection or failed request; `layout(...)` in `run.py` finds controls that are cut off,
  unreachable or covered.
- The game handle `window.__vtStation` is created by the station in dev builds only; a new game
  should expose its own dev-only handle the same way if tests need to drive it.

## Sound

Sound cannot be heard here. `run.py --only audio` checks the wiring through dev-only counters;
`python3 tools/harness/audio_render.py` renders every tape, one-shot and ambience layer offline
(OfflineAudioContext, through the game's real bus graph), measures peak, loudness, DC offset, spectral
centroid, energy above 8 kHz and clipping, fails on the limits listed at the top of the script, and
writes WAVs and spectrogram PNGs to `/tmp/stage1c-audio` (or `--out`). Look at the PNGs. Neither
replaces listening.

## What it cannot prove

Everything behind the mock: the Rust commands themselves, the database, warframe.market, the
AlecaFrame file, the EE.log parser, real event timing. Also WebView2 specifics (the app runs in
WebView2 on Windows, the harness in Chromium), pointer lock in first person, GPU performance,
sound output, the installer and the updater. The contract check covers argument names and
primitive types, not the fields inside struct arguments or the returned data: the mock's data
was written by reading the Rust structs, it is not generated from them.
