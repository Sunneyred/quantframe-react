"""The `audio` scenario: the 3D game's sound system, tested structurally (nothing can be heard here).

It drives the real app on the mock backend and reads the dev-only counters of the audio system
(`window.__vtGame.engine.audio.debug`, and `window.__vtAudioDebug` which outlives a mount):
context state, live nodes and voices, the log of triggered sounds with their positions, bus gains.
What the sound is like is checked offline by audio_render.py.
"""

from __future__ import annotations

import math

from lib import Suite

STORAGE = {"vt_station_start": "0", "vt_game_quality": "low", "vt_game_view": "first"}
# rooms/vault/audioProps.ts: the deck stands at polar(168, 7.4) and faces (-1.4, 9.3); the panel is on the pillar at 195 degrees
DECK = (math.sin(math.radians(168)) * 7.4, -math.cos(math.radians(168)) * 7.4)
_d = (-1.4 - DECK[0], 9.3 - DECK[1])
_n = math.hypot(*_d)
DECK_STAND = (DECK[0] + _d[0] / _n * 1.25, DECK[1] + _d[1] / _n * 1.25)
PANEL_STAND = (math.sin(math.radians(195)) * 10.3, -math.cos(math.radians(195)) * 10.3)


def A(pg, expr: str):
    """Evaluate against the audio system (`a`) and the game handle (`g`)."""
    return pg.evaluate("() => { const g = window.__vtGame; if (!g) return null; const a = g.engine.audio; return %s; }" % expr)


def steps(pg, n: int = 10, dt: float = 0.05, render: bool = False) -> None:
    """Advance the simulation without drawing (software WebGL is slow); `render` draws one frame for the screenshot."""
    pg.evaluate("([n, dt, r]) => { const e = window.__vtGame.engine; for (let i = 0; i < n; i++) e.step(dt, false); if (r) e.step(0.016); }", [n, dt, render])


def triggers(pg, name: str) -> list:
    return pg.evaluate("(n) => window.__vtGame.engine.audio.debug.triggers.filter((t) => t.name === n)", name)


def near(a, b, tol: float) -> bool:
    return a is not None and b is not None and all(abs(x - y) <= tol for x, y in zip(a, b))


def open_game(s: Suite, first: bool = True):
    pg = s.page
    pg.wait_for_selector("nav button", timeout=60000)
    pg.wait_for_selector("[class*=splashScreen]", state="detached", timeout=30000)
    pg.wait_for_timeout(300)
    enter_game(pg)
    return pg


def enter_game(pg) -> None:
    pg.evaluate("() => { if (location.pathname !== '/game') { history.pushState({}, '', '/game'); dispatchEvent(new PopStateEvent('popstate')); } }")
    pg.wait_for_function("() => window.__vtGame && window.__vtGame.market.state.market", timeout=90000)
    pg.evaluate("() => window.__vtGame.engine.stop()")
    steps(pg, 3)


def gesture(pg) -> None:
    """A real (trusted) key press that the game itself ignores: the audio context starts on it."""
    pg.keyboard.press("KeyQ")
    pg.wait_for_function("() => window.__vtGame.engine.audio.debug.state === 'running'", timeout=20000)


def stand(pg, at: tuple[float, float], point: str) -> None:
    pg.evaluate(
        "([x, z, k]) => { const g = window.__vtGame; g.place(x, z, 0); const p = g.vault.audioProps.points[k]; g.aimAt(p.x, p.y, p.z); }",
        [at[0], at[1], point],
    )
    steps(pg, 2)
    # the reticle is the camera's ray (the camera sits a little ahead of the eye): aim that exactly
    pg.evaluate(
        "(k) => { const g = window.__vtGame; const p = g.vault.audioProps.points[k]; const c = g.engine.camera.position; const dx = p.x - c.x, dy = p.y - c.y, dz = p.z - c.z; g.engine.player.yaw = Math.atan2(-dx, -dz); g.engine.player.pitch = Math.atan2(dy, Math.hypot(dx, dz)); }",
        point,
    )
    steps(pg, 2)


def focused(pg):
    return pg.evaluate("() => { const f = window.__vtGame.engine.interact.focused; return f ? { id: f.id, verb: f.verb, label: f.label } : null; }")


def scenario_audio(s: Suite) -> None:
    with s.step("audio: the game boots silent, with no context before a gesture"):
        pg = s.open(1280, 800, storage=STORAGE)
        pg.set_default_timeout(60000)
        open_game(s)
        d = A(pg, "a.debug")
        s.check(d["state"] == "none" and not d["unlocked"], f"a context exists before any gesture: {d['state']}")
        s.check(d["settings"] == {"master": 0.8, "muted": False, "music": 0.7, "track": "brass-starlight", "playing": True}, f"default settings: {d['settings']}")
        s.check(A(pg, "a.play('click')") is False, "a sound claims to have played without a context")
        s.check(pg.evaluate("() => window.__vtAudioDebug.global.open") == 0, "a context is open before any gesture")
        s.check(abs(d["appSoundScale"] - 0.64) < 1e-6, f"the classic app's sounds do not follow the in-world master: scale {d['appSoundScale']}")
        s.check(A(pg, "Object.keys(g.vault.audioProps.points).length") == 7, "tape deck / master panel props missing")

    with s.step("audio: a user gesture starts the context, the graph, the room tone and the tape"):
        gesture(pg)
        pg.wait_for_timeout(700)
        steps(pg, 2)
        d = A(pg, "a.debug")
        s.check(d["state"] == "running", f"context is {d['state']}")
        s.check(d["sampleRate"] >= 22050, f"sample rate {d['sampleRate']}")
        s.check(d["fixedNodes"] > 40, f"only {d['fixedNodes']} fixed nodes: graph, music path or room tone missing")
        s.check(abs(d["masterGain"] - 0.64) < 0.01, f"master gain {d['masterGain']} for the dial at 80 %")
        s.check(abs(d["musicGain"] - 0.49) < 0.01, f"music gain {d['musicGain']} for the knob at 70 %")
        s.check(d["music"]["playing"] and d["music"]["bars"] >= 1 and d["music"]["voices"] >= 1, f"the tape is not running: {d['music']}")
        s.check(d["global"]["open"] == 1 and d["global"]["created"] == 1, f"contexts: {d['global']}")
        s.check(d["mix"][0] > 0.9 and d["mix"][1] < 0.1, f"room tone is not the Vault's: {d['mix']}")
        s.check(near([d["music"]["source"][k] for k in "xyz"], [A(pg, "g.vault.audioProps.points.speaker." + k) for k in "xyz"], 1e-6), "the music does not come from the deck's speaker")
        s.check(A(pg, "a.context.listener.positionY ? a.context.listener.positionY.value : 1.6") > 1.2, "the listener is not on the camera")

    with s.step("audio: walking makes footsteps at a walking stride, left and right, none when standing or against a wall"):
        pg.evaluate("() => { const g = window.__vtGame; g.place(-5, 6, 0); g.engine.player.pitch = 0; g.engine.audio.clearTriggers(); }")
        steps(pg, 20)
        s.check(len(triggers(pg, "footstep")) == 0, "footsteps while standing still")
        pg.evaluate("() => window.__vtGame.engine.input.keys.add('KeyW')")
        steps(pg, 80)  # 4 s of walking north
        walk = triggers(pg, "footstep")
        rate = len(walk) / 4.0
        s.check(2.0 <= rate <= 3.2, f"{len(walk)} footsteps in 4 s of walking ({rate:.2f}/s; the avatar's legs do about 2.6/s)")
        gaps = [b["t"] - a["t"] for a, b in zip(walk[2:], walk[3:])]
        s.check(gaps and max(gaps) - min(gaps) < 0.11, f"uneven stride at a steady walk: {gaps}")
        feet = [t["opts"].get("foot") for t in walk]
        s.check(all(a != b for a, b in zip(feet, feet[1:])), f"feet do not alternate: {feet}")
        s.check(all(t["opts"].get("surface") == "stone" for t in walk), "the Vault's floor is not stone")
        s.check(all(abs(t["position"][1] - 0.03) < 1e-6 for t in walk), "footsteps are not at floor level")
        s.check(all((t["position"][0] < -5) == (t["opts"]["foot"] == "L") for t in walk), "left and right feet are not on their sides of the path")
        s.check(all(t["played"] for t in walk), "footsteps were dropped")
        pg.evaluate("() => { const g = window.__vtGame; g.engine.audio.clearTriggers(); g.place(-5, 6, 0); g.engine.input.keys.add('ShiftLeft'); }")
        steps(pg, 40)  # 2 s of sprinting
        run = len(triggers(pg, "footstep")) / 2.0
        s.check(3.2 <= run <= 4.7 and run > rate, f"sprint cadence {run:.2f}/s against {rate:.2f}/s walking")
        pg.evaluate("() => { const g = window.__vtGame; g.engine.input.keys.clear(); }")
        steps(pg, 20)
        # against the south wall: the keys are down but the player does not move
        pg.evaluate("() => { const g = window.__vtGame; g.place(0, 10.45, Math.PI); g.engine.input.keys.add('KeyW'); }")
        steps(pg, 10)
        pg.evaluate("() => window.__vtGame.engine.audio.clearTriggers()")
        steps(pg, 40)
        s.check(len(triggers(pg, "footstep")) == 0, f"{len(triggers(pg, 'footstep'))} footsteps while pushing against a wall")
        pg.evaluate("() => window.__vtGame.engine.input.keys.clear()")
        steps(pg, 10)

    with s.step("audio: the tape deck: next, previous, pause and the volume knob (E, Shift+E, wheel)"):
        stand(pg, DECK_STAND, "next")
        f = focused(pg)
        s.check(f and f["id"] == "deck-next" and f["label"] == "Brass & Starlight", f"looking at the next key gives {f}")
        s.check(pg.evaluate("() => window.__vtGame.engine.interact.hint.visible"), "no in-world hint on the deck")
        pg.evaluate("() => window.__vtGame.engine.audio.clearTriggers()")
        pg.keyboard.press("KeyE")
        steps(pg, 2)
        d = A(pg, "a.debug")
        s.check(d["settings"]["track"] == "slow-orbit" and d["music"]["name"] == "Slow Orbit", f"next tape: {d['settings']['track']}")
        s.check(d["music"]["fading"] == 1, f"no crossfade from the old tape: {d['music']}")
        btn = triggers(pg, "deck-button")
        s.check(len(btn) == 1 and near(btn[0]["position"], [A(pg, "g.vault.audioProps.points.next." + k) for k in "xyz"], 1e-6), f"key sound not at the key: {btn}")
        s.check(focused(pg)["label"] == "Slow Orbit", "the hint does not show the new tape")
        pg.keyboard.press("KeyE")
        steps(pg, 2)
        s.check(A(pg, "a.settings.track") == "chrome-lagoon", "second press of next")
        s.check(A(pg, "a.debug.music.fading") == 1, "more than one tape fading out")
        stand(pg, DECK_STAND, "prev")
        s.check(focused(pg)["id"] == "deck-prev", f"prev key not focused: {focused(pg)}")
        for _ in range(3):
            pg.keyboard.press("KeyE")
            steps(pg, 1)
        s.check(A(pg, "a.settings.track") == "cassette-dusk", f"previous wraps around to the last tape: {A(pg, 'a.settings.track')}")
        stand(pg, DECK_STAND, "play")
        f = focused(pg)
        s.check(f["id"] == "deck-play" and f["verb"] == "Pause", f"play key: {f}")
        pg.keyboard.press("KeyE")
        steps(pg, 2)
        s.check(A(pg, "a.settings.playing") is False and focused(pg)["verb"] == "Play", "pause did not pause")
        pg.keyboard.press("KeyE")
        steps(pg, 2)
        s.check(A(pg, "a.settings.playing") is True, "play did not resume")
        stand(pg, DECK_STAND, "volume")
        f = focused(pg)
        s.check(f["id"] == "deck-volume" and f["label"] == "Music volume 70%" and "Shift+E" in f["verb"], f"volume knob hint: {f}")
        pg.keyboard.press("KeyE")
        steps(pg, 1)
        s.check(A(pg, "a.settings.music") == 0.75, f"E turns the knob up: {A(pg, 'a.settings.music')}")
        pg.keyboard.down("ShiftLeft")
        pg.keyboard.press("KeyE")
        pg.keyboard.press("KeyE")
        pg.keyboard.up("ShiftLeft")
        steps(pg, 1)
        s.check(A(pg, "a.settings.music") == 0.65, f"Shift+E turns it down: {A(pg, 'a.settings.music')}")
        pg.mouse.move(640, 400)
        for _ in range(3):
            pg.mouse.wheel(0, 120)
        pg.wait_for_timeout(250)
        steps(pg, 2)
        s.check(A(pg, "a.settings.music") == 0.5, f"the wheel turns it down: {A(pg, 'a.settings.music')}")
        s.check(focused(pg)["label"] == "Music volume 50%", "the hint does not follow the knob")
        s.check(abs(A(pg, "a.debug.musicGain") - 0.25) < 0.02, f"music gain {A(pg, 'a.debug.musicGain')} for the knob at 50 %")
        s.check(len(triggers(pg, "knob")) == 6, f"{len(triggers(pg, 'knob'))} knob detents for 6 steps")
        stand(pg, DECK_STAND, "play")
        pg.keyboard.press("KeyE")  # leave it paused for the reload
        steps(pg, 20)

    with s.step("audio: the master panel: the brass dial and the mute switch govern everything"):
        stand(pg, PANEL_STAND, "master")
        f = focused(pg)
        s.check(f and f["id"] == "audio-master" and f["label"] == "Master volume 80%", f"master dial: {f}")
        pg.keyboard.press("KeyE")
        steps(pg, 1)
        s.check(A(pg, "a.settings.master") == 0.85, "E turns the master up")
        pg.mouse.move(640, 400)
        for _ in range(3):
            pg.mouse.wheel(0, 120)
        pg.wait_for_timeout(300)
        steps(pg, 2)
        s.check(A(pg, "a.settings.master") == 0.7, f"wheel on the master dial: {A(pg, 'a.settings.master')}")
        s.check(abs(A(pg, "a.debug.masterGain") - 0.49) < 0.01, f"master gain {A(pg, 'a.debug.masterGain')} for the dial at 70 %")
        s.check(abs(A(pg, "a.debug.appSoundScale") - 0.49) < 1e-6, "classic app sounds do not follow the dial")
        stand(pg, PANEL_STAND, "mute")
        f = focused(pg)
        s.check(f and f["id"] == "audio-mute" and f["verb"] == "Mute", f"mute switch: {f}")
        pg.keyboard.press("KeyE")
        pg.wait_for_timeout(400)
        steps(pg, 12)
        d = A(pg, "a.debug")
        s.check(d["settings"]["muted"] is True and d["masterGain"] == 0, f"mute does not drive the master gain to 0: {d['masterGain']}")
        s.check(d["appSoundScale"] == 0, "classic app sounds are not muted with the ship")
        s.check(focused(pg)["verb"] == "Unmute", "the switch's hint does not change")
        s.check(d["state"] == "running", "muting must not stop the context")

    with s.step("audio: track, volumes, pause and mute survive a reload"):
        before = A(pg, "a.settings")
        pg.reload()
        open_game(s)
        d = A(pg, "a.debug")
        s.check(d["settings"] == before, f"settings after reload {d['settings']} != {before}")
        s.check(before == {"master": 0.7, "muted": True, "music": 0.5, "track": "cassette-dusk", "playing": False}, f"unexpected state before the reload: {before}")
        s.check(d["appSoundScale"] == 0, "the mute does not apply to app sounds after a reload")
        gesture(pg)
        pg.wait_for_timeout(500)
        d = A(pg, "a.debug")
        s.check(d["masterGain"] == 0, f"muted ship is audible after a reload: master {d['masterGain']}")
        s.check(d["music"]["bars"] == 0 and d["music"]["voices"] == 0, f"a paused tape plays after a reload: {d['music']}")
        pg.evaluate("() => { const a = window.__vtGame.engine.audio; a.setMuted(false); a.setMaster(0.8); a.music.setVolume(0.7); a.music.select('brass-starlight'); a.music.play(); }")
        pg.wait_for_timeout(500)
        d = A(pg, "a.debug")
        s.check(abs(d["masterGain"] - 0.64) < 0.01 and d["music"]["bars"] >= 1, f"unmute / play through the API: {d['masterGain']}, {d['music']}")

    with s.step("audio: a sale rings at the reservoir, and the announcement at the PA display"):
        pg.evaluate("() => window.__vtGame.engine.audio.clearTriggers()")
        pg.evaluate("() => window.__HARNESS__.trade('StarHollow', 40, 'Sale')")
        pg.wait_for_function("() => window.__vtGame.engine.audio.debug.triggers.some((t) => t.name === 'sale')", timeout=20000)
        sale = triggers(pg, "sale")
        s.check(near(sale[0]["position"], [0, 2.6, 0], 1e-6) and sale[0]["opts"].get("amount") == 40 and sale[0]["played"], f"sale sound: {sale}")
        pg.wait_for_function("() => window.__vtGame.engine.audio.debug.triggers.some((t) => t.name === 'announce')", timeout=20000)
        ann = triggers(pg, "announce")
        s.check(ann[0]["opts"].get("tone") == "gold" and ann[0]["position"][1] > 3, f"announcement sound: {ann[0]}")
        steps(pg, 5)

    url = "nova_prime_set"
    with s.step("audio: room change, focus chime at the star, undercut alert at the spire"):
        pg.evaluate("() => { const g = window.__vtGame; g.engine.audio.clearTriggers(); g.place(0.2, -8, 0); g.engine.player.pitch = 0; g.engine.input.keys.add('KeyW'); }")
        for _ in range(10):
            steps(pg, 20)
            if pg.evaluate("() => window.__vtGame.where === 'observatory' && window.__vtGame.engine.player.pos.z < -24"):
                break
        pg.evaluate("() => window.__vtGame.engine.input.keys.clear()")
        steps(pg, 4)
        arches = triggers(pg, "arch")
        s.check(len(arches) == 2 and all(t["opts"].get("direction") == "in" for t in arches), f"arch transitions: {arches}")
        surfaces = [t["opts"]["surface"] for t in triggers(pg, "footstep")]
        s.check("metal" in surfaces and surfaces[-1] == "hollow" and surfaces[0] == "stone", f"floor surfaces on the way: {sorted(set(surfaces))}")
        pg.wait_for_timeout(2500)
        d = A(pg, "a.debug")
        s.check(d["room"] == "observatory" and d["mix"][1] > 0.9 and d["mix"][0] < 0.1 and d["mix"][3] > 0.9 and d["mix"][2] < 0.1, f"room tone and reverb did not follow into the observatory: {d['mix']}")
        s.check(d["mix"][4] > 0.9, "the market texture does not come up in the observatory")
        # focus
        star = pg.evaluate("(u) => { const g = window.__vtGame; const s = g.market.state.market.overview.items.find((i) => i.wfm_url === u); const p = g.observatory.orrery.starWorld(u); return { trend: s.trend, dir: s.trend_dir, p: [p.x, p.y, p.z] }; }", url)
        pg.evaluate("() => window.__vtGame.engine.audio.clearTriggers()")
        pg.evaluate("(u) => window.__vtGame.market.focus(u)", url)
        pg.wait_for_function("() => window.__vtGame.engine.audio.debug.triggers.some((t) => t.name === 'chime')", timeout=20000)
        ch = triggers(pg, "chime")[0]
        k = max(-1.0, min(1.0, star["trend"] / 0.25))
        want = 587.33 if star["dir"] == "unknown" else 880 * 2 ** (k * 7 / 12)
        s.check(near(ch["position"], star["p"], 1e-3), f"focus chime at {ch['position']}, the star is at {star['p']}")
        s.check(abs(ch["opts"]["pitch"] - want) < 0.5, f"focus chime pitch {ch['opts']['pitch']} for trend {star['trend']} ({star['dir']}), expected {want:.1f}")
        hi = A(pg, "(() => { const m = g.market.state.market.overview.items; const up = m.filter((i) => i.trend_dir === 'rising').sort((x, y) => y.trend - x.trend)[0]; const dn = m.filter((i) => i.trend_dir === 'falling').sort((x, y) => x.trend - y.trend)[0]; return [up.wfm_url, dn.wfm_url]; })()")
        pg.evaluate("() => window.__vtGame.engine.audio.clearTriggers()")
        pg.evaluate("(u) => window.__vtGame.market.focus(u)", hi[0])
        pg.wait_for_function("() => window.__vtGame.engine.audio.debug.triggers.filter((t) => t.name === 'chime').length === 1", timeout=20000)
        pg.evaluate("(u) => window.__vtGame.market.focus(u)", hi[1])
        pg.wait_for_function("() => window.__vtGame.engine.audio.debug.triggers.filter((t) => t.name === 'chime').length === 2", timeout=20000)
        up, dn = triggers(pg, "chime")
        s.check(up["opts"]["pitch"] > 1000 > 780 > dn["opts"]["pitch"] and up["opts"]["brightness"] > 0.7 > 0.3 > dn["opts"]["brightness"], f"rising {up['opts']} / falling {dn['opts']}")
        # undercut
        pg.evaluate("(u) => window.__vtGame.market.focus(u)", url)
        pg.wait_for_function("(u) => { const st = window.__vtGame.market.state; return st.focus && st.focus.wfm_url === u && st.book; }", arg=url, timeout=30000)
        steps(pg, 5)
        s.check(len(triggers(pg, "alert")) == 0, "alert without an undercut")
        s.check(pg.evaluate("(u) => window.__HARNESS__.marketUndercut(u, 3)", url) is True, "no own order to undercut")
        pg.evaluate("() => window.__vtGame.market.refresh()")
        pg.wait_for_function("() => { const b = window.__vtGame.market.state.book; return b && b.summary.undercut_by; }", timeout=30000)
        steps(pg, 5)
        al = triggers(pg, "alert")
        spire = A(pg, "(() => { const p = g.engine.interact.get('spire').position; return [p.x, p.y, p.z]; })()")
        s.check(len(al) == 1 and near(al[0]["position"], spire, 0.01) and al[0]["played"], f"undercut alert {al}, spire at {spire}")
        before = len(pg.evaluate("() => window.__HARNESS__.calls.filter((x) => x.cmd === 'vt_order_book')"))
        pg.evaluate("() => window.__vtGame.market.refresh()")
        pg.wait_for_function("(n) => window.__HARNESS__.calls.filter((x) => x.cmd === 'vt_order_book').length > n && !window.__vtGame.market.state.bookLoading", arg=before, timeout=30000)
        steps(pg, 5)
        s.check(len(triggers(pg, "alert")) == 1, "the same undercut is announced again on every refresh")

    with s.step("audio: consoles (engage, click, disengage), the exposed voices, the voice limit"):
        pg.evaluate("() => { const g = window.__vtGame; g.engine.audio.clearTriggers(); g.engine.screens.dock('market'); }")
        steps(pg, 30)
        s.check(len(triggers(pg, "dock")) == 1, "no engage sound")
        pg.locator("[data-vtg-filter='mine']").dispatch_event("click")
        pg.wait_for_function("() => window.__vtGame.market.state.filter.mine === true", timeout=10000)
        s.check(len(triggers(pg, "click")) == 1, f"{len(triggers(pg, 'click'))} click sounds for one click on a docked screen")
        pg.locator("[data-vtg-filter='mine']").dispatch_event("pointerover", {"bubbles": True})
        s.check(len(triggers(pg, "hover")) == 1, f"{len(triggers(pg, 'hover'))} hover ticks")
        pg.locator("[data-vtg-filter='mine']").dispatch_event("click")
        pg.evaluate("() => window.__vtGame.engine.screens.undock()")
        steps(pg, 30)
        s.check(len(triggers(pg, "undock")) == 1, "no disengage sound")
        ok = A(pg, "[a.chime({ pitch: 660, brightness: 0.4, position: { x: 0, y: 2, z: -30 }, gain: 0.5 }), a.market.chime({ pitch: 990 }), a.robot.servo({ position: { x: 1, y: 0.5, z: -30 } }), a.robot.whirr(), a.robot.beep({ mood: 'query' }), a.play('alert')]")
        s.check(ok == [True] * 6, f"exposed voices did not play: {ok}")
        A(pg, "a.market.texture.set(0.8)")
        s.check(A(pg, "a.market.texture.get()") == 0.8, "market texture density is not settable")
        grains = A(pg, "a.debug.texture.grains")
        pg.wait_for_timeout(1500)
        s.check(A(pg, "a.debug.texture.grains") - grains >= 8, f"the market texture is not busier at density 0.8: {A(pg, 'a.debug.texture.grains') - grains} grains in 1.5 s")
        A(pg, "a.market.texture.set(0.12)")
        # a flood of one-shots is capped, and every voice is released when it ends
        A(pg, "(() => { for (let i = 0; i < 200; i++) a.play('click'); })()")
        d = A(pg, "a.debug")
        s.check(d["oneShots"] <= 40 and d["dropped"] >= 150, f"no voice limit: {d['oneShots']} live, {d['dropped']} dropped")
        pg.wait_for_function("() => window.__vtGame.engine.audio.debug.oneShots === 0", timeout=30000)
        d = A(pg, "a.debug")
        s.check(d["liveVoices"] < 40, f"voices pile up: {d['liveVoices']} live of {d['started']} started")

    with s.step("audio: leaving the game closes the context and releases every node"):
        pg.wait_for_timeout(1500)
        d0 = A(pg, "a.debug")
        base = {"fixed": d0["fixedNodes"], "dom": pg.evaluate("() => window.__HARNESS__.domListeners()")}
        s.check(d0["global"]["nodes"] == d0["liveNodes"] and d0["global"]["voices"] == d0["liveVoices"], f"nodes outside the live system: {d0['global']} vs {d0['liveNodes']}/{d0['liveVoices']}")
        pg.evaluate("() => { window.__vtOldCtx = window.__vtGame.engine.audio.context; }")
        leave(pg)
        g = pg.evaluate("() => window.__vtAudioDebug.global")
        s.check(g["open"] == 0 and g["nodes"] == 0 and g["voices"] == 0, f"after unmount: {g}")
        s.check(pg.evaluate("() => window.__vtOldCtx.state") == "closed", "the AudioContext was not closed")
        s.check(pg.evaluate("() => window.__vtAudioDebug.appSoundScale()") == 1, "the classic app's sounds stay scaled after the game unmounted")
        pg.evaluate("() => { delete window.__vtOldCtx; }")

    for i in range(3):
        with s.step(f"audio: remount {i + 1}: one context, the same fixed nodes, nothing left behind"):
            enter_game(pg)
            gesture(pg)
            pg.wait_for_timeout(1200)
            d = A(pg, "a.debug")
            s.check(d["global"]["open"] == 1, f"{d['global']['open']} contexts open")
            s.check(d["fixedNodes"] == base["fixed"], f"fixed nodes {d['fixedNodes']} vs {base['fixed']} on the first mount")
            s.check(d["global"]["nodes"] == d["liveNodes"] and d["global"]["voices"] == d["liveVoices"], f"nodes from an earlier mount are alive: {d['global']} vs {d['liveNodes']}/{d['liveVoices']}")
            s.check(d["liveNodes"] < base["fixed"] + 400 and d["liveVoices"] < 60, f"live counts grew: {d['liveNodes']} nodes, {d['liveVoices']} voices")
            dom = pg.evaluate("() => window.__HARNESS__.domListeners()")
            grown = {k: (base["dom"].get(k, 0), v) for k, v in dom.items() if v > base["dom"].get(k, 0)}
            s.check(not grown, f"window/document listeners grew: {grown}")
            leave(pg)
            g = pg.evaluate("() => window.__vtAudioDebug.global")
            s.check(g["open"] == 0 and g["nodes"] == 0 and g["voices"] == 0 and g["closed"] == g["created"], f"after unmount {i + 1}: {g}")


def leave(pg) -> None:
    pg.evaluate("() => { history.pushState({}, '', '/trading_analytics'); dispatchEvent(new PopStateEvent('popstate')); }")
    pg.wait_for_selector("[data-vtg-host]", state="detached", timeout=30000)
    pg.wait_for_function("() => window.__vtAudioDebug.global.open === 0", timeout=15000)
