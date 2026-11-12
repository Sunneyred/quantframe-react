# Void Trader, the game (phase 2: the Vault and the Market Observatory)

Route `game` inside the app (`GamePage.tsx`, lazy chunk), or standalone on demo data at
`/src/game/dev.html` on the Vite dev server.

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
Mantine portals opened on a screen are pointed at that screen via a nested `MantineThemeProvider`, but
popover positioning inside a 3D transform is untested: prefer inline lists to `Select` on screens.

## Notifications

While the game is mounted, `useNotificationCapture` subscribes to Mantine's `notificationsStore` and
mirrors every new or changed notification to the ticker ring and the PA display, and a style tag hides
`.mantine-Notifications-root`. The app's notification code is unchanged and its timers keep running.
Modals (`@mantine/modals`): the app's ModalsProvider renders them into Mantine's shared portal node in
<body>. `ModalRouter` watches that node; when a modal opens it moves the whole node (React only holds a
reference to the container, not its place) into the content of a hidden "comms" screen, places that screen
in front of the camera (or just in front of the engaged screen) and docks it. Inside the screen's 3D
transform Mantine's fixed overlay is contained by the screen. When the modal closes the node goes back to
<body> and the previous screen is engaged again; disengaging the comms screen closes the modals; on unmount
the node is always put back before the engine removes its DOM.

## Leaving the route

`LogInLayout` wraps the route outlet in a `Suspense` keyed by the first path segment, so a navigation to a
lazy page unmounts the page being left at once (React 19 transitions would otherwise keep the old tree,
the full-window game, until the chunk loads). As a second net, GameCore hides its host and stops the
engine as soon as `location.pathname` differs from the one it mounted on.

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
