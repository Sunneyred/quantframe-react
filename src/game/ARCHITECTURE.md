# Void Trader, the game (phase 2: the Vault and the Market Observatory)

The game IS the logged-in app: every logged-in route renders it (`GameShell.tsx` -> `GamePage.tsx`, lazy
chunk) and nothing else is on screen. Standalone on demo data at `/src/game/dev.html` on the Vite dev server.
What each app function became in the world: `COVERAGE.md`.

## The world-only shell

- `components/Layouts/Routes.tsx`: while `useClassicMode()` is false (the default) the logged-in routes are
  one index route and one `*` route, both `<GameShell />`; `LogInLayout` then renders only the outlet: no
  AppShell, header, side bar or alert ticker exist. Login, error, banned and splash are unchanged.
- Screen space holds only `.vtg-reticle` (hidden while a screen is engaged). Toasts are captured (`notify.ts`)
  and shown on the PA display, the ticker ring and the foot of the engaged terminal; dialogs go to the Comms
  display (`modalRouter.ts`); the header's clock and alerts are the Bridge Watch; every classic page is a
  Service Deck terminal.
- `shellMode.ts`: the hidden classic fallback. `localStorage vt_classic_mode = "1"` makes the router render
  the full classic shell and routes instead. It is set by `fallBackToClassic(reason)` (reason kept in
  `vt_classic_reason` and shown once as a notice in the classic view) when: the game's React tree throws
  (`GameBoundary` in GamePage, `ShellBoundary` in GameShell for a chunk that fails to load), the engine cannot
  create a WebGL context, no first frame is drawn within the watchdog time (25 s of visible time;
  `vt_game_watchdog_ms` overrides it), or the WebGL context is lost. Ctrl+Shift+F12 toggles it by hand
  (`useClassicChord`, mounted in AppRoutes so it works in both views). "Return to the ship" (the star at the
  top of the classic side bar) clears it. A page crashing inside a terminal is contained by that terminal's
  own boundary and never triggers the fallback.
- Dev builds only: `localStorage vt_game_test_fault = stall | webgl | crash` provokes each failure (harness).
- `shell.css`: `overflow: clip` on the host, root, CSS3D layer and screen content (with `overflow: hidden` a
  focus or scroll-into-view scrolls the DOM layer and every screen is then drawn beside its hole), and no
  `backdrop-filter` on screens (the app theme blurs every Paper/Card; inside the 3D layer each one is a render
  surface, which cost seconds per frame and enough memory to kill the page under software rendering).

## The Service Deck (embedded classic pages)

- `rooms/vault/terminals.ts` builds a curved bank of eleven lectern terminals along the south windows
  (149 to 213 degrees, radius 10.05) from palette materials, their colliders and screens (`svc-<id>`), the
  "SERVICE DECK" sign, and the Bridge Watch screen (`svc-watch`) on the 240 degree wall. `VaultRoom.deck`
  exposes it; `standAt(id)` gives a place to stand (tests, later fast travel).
- `ui/ServiceDeck.tsx` renders the content through portals: an idle face (static, sized in container units)
  until engaged, then the real classic page (the same lazy chunks as the classic routes) inside the shared
  `Frame`, in a `TerminalBoundary`. The page stays mounted while one of its dialogs is on Comms (its callbacks
  belong to it) and is unmounted on disengage. `ui/Consoles.tsx`: settings form and account console (the user
  menu's functions). `ui/BridgeWatch.tsx`: the app's `Clock` and the alert list (links open when engaged).
- `fitScreenToView(engine, id)`: on dock, a terminal's DOM is resized to the pixel size it has on the monitor
  (the world size is unchanged, only `element.style.width/height` and `css.scale`), so pages are laid out for
  the real window and are shown 1:1; floating-ui then positions dropdowns, date pickers and tooltips correctly
  (verified by the `shell` harness scenario). Comms is fitted the same way when it opens.
- `terminals.css`: layout of the idle face and page box (`--vt-vh` from the box height, as the station's
  panels do), the frame inset that keeps content clear of the bevelled bezel, and the reset of game.css's
  terminal-control restyle of Mantine inside `.vtg-term` screens (embedded pages keep the app theme).

## Layout

- `core/Engine.ts`: renderer (ACES, sRGB), optional bloom chain, CSS3D layer, scene, player, screens,
  interaction, per-frame systems, quality, resize, tab-hidden pause, full disposal.
- `core/screens.ts`: diegetic DOM screens and docking. `core/interact.ts`: look-at interaction with an
  in-world hint. `core/player.ts`: movement, collision, first/third person. `core/collision.ts`: circles,
  rotated boxes, a round boundary. `core/input.ts`: keys, mouse, pointer lock. `core/quality.ts`.
- `art/`: every texture is drawn on canvases in code (`textures.ts`), shared materials (`materials.ts`),
  the Void sky, shards, motes and light shafts (`void.ts`), building blocks (`kit.ts`).
- `entities/figures.ts`: the player avatar and customer figures, built from primitives.
- `rooms/vault/`: the first room (`index.ts` assembles it; `shell.ts` architecture; `reservoir.ts`;
  `customers.ts`).
- `rooms/observatory/`: the Market Observatory north of the Vault (`index.ts` assembles it, the corridor,
  the console lectern, the legend; `shell.ts` architecture and corridor; `orrery.ts` the star map;
  `spire.ts` the Order Spire; `ribbon.ts` the Price Ribbon). `rooms/ship.ts` composes both rooms into the
  engine's one Room and reports where the player is.
- `market/`: `layout.ts` (pure mapping from market data to the Orrery: sectors, positions, colours,
  filters, movers), `data.ts` (the Tauri commands, with demo fallback), `demo.ts` (demo market).
- `modalRouter.ts`: app modals routed onto the in-world Comms display.
- `ui/`: the React content shown on screens. `GameCore.tsx` owns the engine, the data and the portals.
- `notify.ts`: in-world announcements and the capture of Mantine notifications.

## Adding a room

Both rooms live in one scene (no loading). Walkable space is the union of `world.area(...)` circles and
rectangles (each hall, the corridor); `world.bound` is only used when no areas exist.
`screens.add(spec, parent)` takes a parent group, so a room can build its screens in its own frame.

Write a class implementing `Room` (`id`, `spawn`, `update(dt, t)`, `dispose()`), build meshes into
`engine.scene`, add colliders to `engine.world`, screens with `engine.screens.add(spec)` and
interactables with `engine.interact.add(item)`. Then `engine.setRoom(room)`. Rooms only build; data
comes in through setters called from React (see `VaultRoom.setGoal`, `surge`, `setQueue`, `setTicker`).

## Adding a screen

```ts
const s = engine.screens.add({ id: "ledger", title: "Ledger", px: [1200, 760], width: 3, position, yaw, dockable: true });
// in GameCore's portals: createPortal(<LedgerScreen />, s.content)
```

`px` is the DOM size in CSS pixels, `width` the world width in metres. Dockable screens get an
"Engage" interactable automatically. `screens.dock(id)` / `screens.undock()`; `engine.events.on("dock")`
reports the docked id (or null). Put a `Frame` (ui/Frame.tsx) around the content for the bezel,
the title and the Disengage control.

## Screens and occlusion

The CSS3D layer sits under a transparent WebGL canvas. Each screen has a "hole" quad at its exact
rectangle that writes colour (0,0,0,0) and depth, so the DOM shows through only where nothing is in
front of it: occlusion is per pixel and costs one quad. Glows use an additive blend that adds colour
without touching alpha, so light spills over screens instead of covering them. On high quality the
scene renders into a half-float target first; bloom and tone mapping run on a copy and the final pass
takes alpha from the scene target (bloom alone never hides a screen). Screens that face away or are off
view are `display: none`. Only the docked screen takes pointer events; the canvas never does.

Rules learned the hard way: no `overflow: hidden` on the transformed `.vtg-screen` element (Chrome then
fails to hit-test it; clip inside `.vtg-screen-content`), and no infinite CSS animations or scroll
containers on screens that are not docked (they make the browser re-composite every in-world layer).
Mantine portals opened on a screen are pointed at that screen via a nested `MantineThemeProvider`. Popover
positioning is right when the screen's DOM is shown 1:1 while docked (`fitScreenToView`); on a fixed-size
native screen that is scaled when docked, prefer inline lists to `Select`.

## Notifications

While the game is mounted, `useNotificationCapture` subscribes to Mantine's `notificationsStore` and
mirrors every new or changed notification to the ticker ring and the PA display, and a style tag hides
`.mantine-Notifications-root`. The app's notification code is unchanged and its timers keep running.
Modals (`@mantine/modals`): the app's ModalsProvider renders them into Mantine's shared portal node in
<body>. `ModalRouter` watches that node; when a modal opens it moves the whole node (React only holds a
reference to the container, not its place) into the content of a hidden "comms" screen, places that screen
in front of the camera (or just in front of the engaged screen) and docks it. Inside the screen's 3D
transform Mantine's fixed overlay is contained by the screen. Placement uses the player's pose (not the
camera's: update and terms dialogs open before the first frame) and shortens when something solid is in the
way. Over an engaged screen the display is scaled down in the world and put 6 cm in front of it, so the
camera hardly moves (at full size the camera would sit a hand's width from it and the browser would raster
its DOM magnified several times). A dialog opened with `closeOnEscape: false` (terms, forced update) locks the
display: Esc re-engages it instead of dismissing it (`ModalRouter.locked`, fed from `useModals()` in GameCore).
When the modal closes the node goes back to
<body> and the previous screen is engaged again; disengaging the comms screen closes the modals; on unmount
the node is always put back before the engine removes its DOM.

## Leaving the ship

The game unmounts when the app switches to the classic view (fallback or key chord) or logs out. As a second
net, GameCore hides its host and stops the engine as soon as `isClassic()` is true, even if React still holds
the tree while a classic chunk loads. `LogInLayout` keeps its `Suspense` keyed by the first path segment for
the classic view.

## The Market Observatory

- Orrery: one `THREE.Points` draw call, custom shader. Sector (constellation) by category, radius by volume
  rank inside it (busiest on the rim), height = price (log, 1p..3000p), size and brightness = volume,
  colour = trend (gold rising, blue-violet falling, pale flat, grey unknown). Own-item rings are drawn in the
  same sprite (gold orbit = live sell order, cyan ring = stock, dashed violet = wish list, halo = inventory).
  Filters dim through the `aDim` attribute. Picking is a CPU pass against the view ray that drives one
  dynamic interactable (E / click focus). Labels are canvas sprites: hovered star, up to 7 near own or busy
  stars, constellation names, the price scale on the axis.
- Spire (`spire.ts`): `bookLevels()` groups the book into price levels; slabs are one InstancedMesh that
  tweens; new levels slide in, undercutters are red, your level gold (dimmed and flickering when undercut),
  a red pulse runs down the column when an undercut appears.
- Data (`ui/useMarket.ts`): overview on mount and on shop changes; order book on focus and every 45 s while
  focused (the backend caches ~40 s per item and spaces requests); history once per focus.
