# Void Trader, the game (phase 2: the Vault and the Market Observatory)

Route `game` inside the app (`GamePage.tsx`, lazy chunk), or standalone on demo data at
`/src/game/dev.html` on the Vite dev server.

## Layout

- `core/Engine.ts`: renderer (ACES, sRGB), optional bloom chain, CSS3D layer, scene, player, screens,
  interaction, per-frame systems, quality, resize, tab-hidden pause, full disposal.
- `core/screens.ts`: diegetic DOM screens and docking. `core/interact.ts`: look-at interaction with an
  in-world hint. `core/player.ts`: movement, collision, first/third person. `core/collision.ts`: circles,
  rotated boxes, a round boundary. `core/input.ts`: keys, mouse, pointer lock. `core/quality.ts`.
- `art/`: the look. Everything is procedural (code-built geometry, canvas and shader textures), no
  asset files. See "Art direction and the art kit" below.
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
scene renders into a half-float target first; depth of field, bloom and tone mapping run on a copy and
the final pass takes alpha from the scene target (bloom alone never hides a screen). Screens that face away or are off
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

## Art direction and the art kit (stage 1B)

A lived-in retro-futurist trading ship: warm, playful, 1970s space-pop. Candy enamel against deep
space, worn brass (the old gold-and-void thread, now an accent), chrome, tufted leather, walnut,
bakelite, analogue dials and tape reels, and as the signature material hand-blown art glass
(latticino canes, millefiori murrine, dichroic film, seed bubbles). Everything is original: do not
copy characters, ships, emblems, props or UI of any franchise.

Files in `art/`:

- `textures.ts`: plumbing (seeded noise, canvases, the glyph script, `CanvasLabel`).
- `surfaces.ts`: canvas surfaces. `enamelPanel` (near white, chipped to primer and metal; the material
  colour supplies the hue, so every enamel shares one map pair), `brassWorn`, `brassBand` (riveted
  trim), `leatherTufted` (colour + rough/metal + normal map of pillows, stitches, buttons), `walnut`,
  `instrumentFace` (dials, VU meter, lamps, switches, with an emissive map) and `INSTRUMENT_DIALS`
  (where the needle meshes go), `tapeReel`, `loungeFloor` (the Vault's floor, drawn once, with the
  room's light baked in), `loungeEnvironment` (the painted equirect), `wallShade`, and `CANDY`.
- `glass.ts`: the glass. `glassPattern` (RGBA: rgb = canes, white where clear; a = density),
  `cheapGlass` (one small shader: fresnel, a reflection of the painted environment sampled as an
  equirect, thin film, the body lit from within; premultiplied, alpha stays honest so glass over a
  DOM screen dims it), `heroGlass` (MeshPhysicalMaterial transmission / thickness / ior / dispersion
  / iridescence), `tiered(mesh, low, makeHigh)` and `applyTier` (the engine swaps tiered meshes with
  the quality; the high material is made on first use), `blown(profile, {ribs, twist})` and `FORMS`.
- `materials.ts`: `Palette`, the shared materials. New names: `brass`, `brassDark`, `chrome`,
  `leather`, `leatherTan`, `quilt`, `wood`, `bakelite`, `rubber`, `enamel[hue]` (panelled, world UVs),
  `paint[hue]` (smooth), `glass[name]` (cheap glass per colour), `instrument`, `reel`, `needle`,
  `warmGlow`, `wallShade`, `env`; `hero(name)` and `glassLike(name, overrides)`. The old names still
  work as aliases: `gold` = brass, `goldDark`, `pearl` = cream enamel panel, `pearlPlain` = cream
  paint, `ivory` = walnut, `steel` = bakelite, `filigree` = the brass band, `cyanGlow` (now teal),
  `goldGlow`, `holo`, `floor`, `shadow`, `dot`, `undersuit`. Leather UVs are in metres x 2.5.
- `kit.ts`: `Batch` (static dressing merged by material: `put(geo, mat, pos, rot, scale)`,
  `at()/frame()` for sub-frames, `build(parent)` = one mesh per material; this is what keeps the
  rooms inside the draw-call budget), `roundedBox`, `additive`, `archPath`, `gyroOrnament`.
- `props.ts`: `Idlers` (all dial needles and tape reels of a room as two instanced meshes),
  `instrumentCluster`, `reelUnit`, `banquette`, `brassRail`, `consoleBody`, `tradeCounter`,
  `pedestal`, `boxM` (box with UVs in metres).
- `fixtures.ts`: `chandelier` (brass corona, bell shades, opal globes, instanced pendants that sway),
  `hangingLamp`, `sconce`, `lightPatches` (the coloured, caustic light glass throws on the floor: one
  merged additive mesh), `haloMaterial`.
- `env.ts`: `bakeEnvironment`: a small generated scene (the painting on a sphere plus HDR emitters
  where the lamps and glass are) through PMREM. It is `scene.environment`: reflections for metal and
  glass, and the ambient light (no hemisphere or fill lights; directional variation comes from it).
- `post.ts`: the `DOF` and `FINISH` passes. `void.ts`: sky, rocks, planets, motes, light shafts.

Lighting is faked cheaply and layered: the baked environment as ambient; one key spot and one warm
point at the chandelier; baked light and occlusion in the floor canvases; `wallShade` strips over the
walls (dark at the foot and under the cornice); contact shadow decals; additive halos behind sconces;
a cove glow on the padded ceiling; `lightPatches` under every art-glass lunette; shafts and dust.

Quality tiers. LOW: one pass to the canvas, no post, cheap glass everywhere, the ceiling's tufting
painted only. HIGH: half-float MSAA target with a depth texture -> depth of field (only while docked:
circle of confusion from each pixel's depth around the docked screen's plane; pixels with alpha 0,
the screen holes, are never blurred or sampled and every pixel keeps its own alpha, so the DOM screen
and its edge stay sharp) -> bloom (restrained) -> output -> finish (scene alpha back, vignette on the
world only). Show glass (the reservoir vessel, the chandelier's globes, the hanging lamps) uses
transmission on HIGH, which costs three's extra scene pass; keep such meshes few.

Rules: wall dressing stays under about 1.1 m (wainscot) or above 5.7 m (cornice) and shallower than
12 cm, so terminals can go on any bay; put new static geometry through a `Batch`; give new glass a
`tiered` pair only if it is a show piece; canvas textures at most 2048 and shared through the palette.
