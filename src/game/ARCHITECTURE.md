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
- `audio/`: all sound, synthesised with the Web Audio API (no audio files). See "Audio" below.
- `rooms/vault/audioProps.ts`: the tape deck and the master volume panel.

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

## Audio

Everything is synthesised live (`src/game/audio/`); there are no samples and no audio files, and all
controls are objects in the world. `engine.audio` is the `AudioSystem`; Engine.ts only constructs it,
calls `audio.update(dt)` after the camera pose, and disposes it.

- `AudioSystem.ts`: one `AudioContext`, created on the first key or pointer press (autoplay policy),
  suspended while the tab is hidden, closed on dispose. Listener = the camera, every frame. Positional
  one-shots go through an HRTF `PannerNode` (inverse distance, `ref` per voice) plus a send to the room
  reverb. Footsteps (the avatar's stride clock, fed by the speed really moved), dock / undock, clicks and
  hover ticks on docked screens are wired here; settings persist in `localStorage["vt_game_audio"]`
  (master, muted, music, track, playing).
- `graph.ts`: buses `music`, `sfx`, `market`, `ambience` -> `master` (volume, mute) -> 22 Hz highpass ->
  limiter (compressor, make-up gain trimmed out) -> soft clip (ceiling -1.4 dBFS). Two generated impulse
  responses (Vault, Observatory); `setRoom` crossfades their returns.
- `voices.ts`: every one-shot as a function `(rack, out, t, opts) => endTime`, and the table `VOICES`
  (bus, level, reference distance, reverb send). `util.ts`: `Rack` (the nodes of one voice, released when
  it ends), noise buffers, envelopes, the seeded PRNG.
- `music.ts`: the tapes. `Composer` (pure, seeded) writes bar after bar: a walk over the degrees of a
  mode, close voicings, a plucked line or an arpeggio, brushed drums in some sections. `TapePlayer`
  schedules bars ~1.2 s ahead: detuned saw/triangle pads through a lowpass with two slow LFOs, FM
  electric piano / FM bell / glass plucks with an echo, a sub bass, wow and flutter (a modulated delay),
  tape saturation, hiss, and a duck on every pulse. Changing tape crossfades over ~3 s.
- `ambience.ts`: the room tone of each hall (crossfaded by where the player is) and `MarketTexture`, a
  granular layer with a density 0..1.
- The music comes from the tape deck's speaker (equal-power panner) plus a bleed through the ship that
  gets duller in the corridor and the Observatory.

API:

```ts
engine.audio.play("sale", { position, amount });          // any name in VOICES; position is optional
engine.audio.chime({ pitch, brightness, position, gain }); // the tuned glass chime (Hz, 0..1)
engine.audio.market.sale({ position, amount });
engine.audio.market.alert({ position });
engine.audio.market.focus({ trend, dir, position });       // chime pitch/brightness from a trend
engine.audio.market.texture.set(0.4);                      // market texture density 0..1 (default 0.12)
engine.audio.robot.servo({ position, pitch, duration });   // also .whirr(...) and .beep({ mood })
engine.audio.music.next() / prev() / toggle() / setVolume(v) / select(id);
engine.audio.setMaster(v); engine.audio.toggleMute();
engine.audio.events.on("settings", fn);                    // for props that show the state
```

`play` returns false (and counts a drop) when nothing sounded: no gesture yet, tab hidden, or more than
40 one-shots alive. Wired events: `rooms/ship.ts` reports the room (`setRoom`: reverb, room tone, floor
surface, an arch sound), `VaultRoom.surge` plays the sale at the reservoir, `ObservatoryRoom.setFocus`
the trend chime at the star and `setBook` the alert at the spire when an undercut appears, `GameCore`'s
`announce` a quiet chime at the PA display.

Adding a sound: write a voice in `voices.ts` (build nodes with the `Rack`, start sources at their time,
return when it is silent; fade the tail, never cut it), add it to `VOICES`, call
`engine.audio.play("name", { position })` from the room. A continuous layer gets its own `Rack` on a bus
(see `roomTone`) and must be killed on dispose. Then run `python3 tools/harness/audio_render.py`: it
renders every tape, voice and layer offline through the real graph, fails on clipping, DC, peaks above
-1 dBFS, music brighter than allowed above 8 kHz or louder than the alerts, and writes WAVs and
spectrograms (look at them). `tools/harness/run.py --only audio` tests the wiring through the dev
counters `engine.audio.debug` and `window.__vtAudioDebug` (dev builds only).

The classic app's notification sounds (`PlaySound` in `utils/helper.ts`, driven by the Rust `play_sound`
event) are HTML audio elements outside this graph. While the game is mounted they are scaled by the
in-world master volume and mute through `setAppSoundScale` (`utils/sound.ts`); on unmount the scale
returns to 1. No Rust change.

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
world only). Show glass (only the reservoir vessel and the chandelier's globes) uses
transmission on HIGH, which costs three's extra scene pass; keep such meshes few.

Rules: wall dressing stays under about 1.1 m (wainscot) or above 5.7 m (cornice) and shallower than
12 cm, so terminals can go on any bay; put new static geometry through a `Batch`; give new glass a
`tiered` pair only if it is a show piece; canvas textures at most 2048 and shared through the palette.
