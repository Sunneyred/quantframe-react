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
