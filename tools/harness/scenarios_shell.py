"""The `shell` scenario: the app is only the 3D game.

Proves that after boot nothing but the world (and the reticle) is on screen, that every Service
Deck terminal docks, shows its real classic page and round-trips one real action through the mock,
that dropdowns, date pickers, tooltips and dialogs of the embedded pages work on a docked screen,
that the update and terms-of-service dialogs appear in the world, and that the hidden classic
fallback (crash, key chord, "Return to the ship") works.

`h` is run.py's module (helpers and constants); this file is registered from run.py.
`SHELL_PARTS=boot,terminals,dialogs,fallback` runs only some parts (for working on one).
"""

from __future__ import annotations

import os
import re

# Everything visible outside the game's own root, and the root's own layers. In the ship the page
# may show the world (the canvas over the in-world DOM layer) and the reticle, nothing else.
ZERO_UI_JS = r"""
() => {
  const root = document.querySelector('.vtg-root');
  if (!root) return { error: 'no game root' };
  const stray = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (root.contains(el) || el.contains(root)) continue;
    if (['SCRIPT', 'STYLE', 'LINK', 'TEMPLATE'].includes(el.tagName)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    stray.push(el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : ''));
  }
  const layers = [...root.children].map((c) => c.className);
  const ret = root.querySelector('.vtg-reticle');
  const rr = ret ? ret.getBoundingClientRect() : null;
  // app frame pieces must not exist at all in the ship
  const frame = ['header', 'nav', '.mantine-AppShell-root', '.mantine-AppShell-navbar', '.mantine-AppShell-header', '[class*=newsTicker]'].filter((q) => [...document.querySelectorAll(q)].some((el) => !el.closest('.vtg-screen')));
  // toasts and dialogs may only exist inside an in-world screen
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (!el.checkVisibility || el.checkVisibility()); };
  const toasts = [...document.querySelectorAll('.mantine-Notification-root')].filter(vis).length;
  const modals = [...document.querySelectorAll('.mantine-Modal-content')].filter((m) => !m.closest('.vtg-screen')).length;
  return { stray: [...new Set(stray)].slice(0, 12), layers, reticle: rr ? { w: rr.width, h: rr.height, cx: rr.left + rr.width / 2, cy: rr.top + rr.height / 2, opacity: getComputedStyle(ret).opacity } : null, frame, toasts, modals, vw: innerWidth, vh: innerHeight };
}
"""

# A control that opens a dialog: click it and let the game run for a second, as it does in the app
# (the dialog lands on the Comms display, which only a drawn frame brings into view; with the engine
# stopped and no frame, headless Chromium has crashed here).
OPEN_JS = "(el) => { el.click(); const e = window.__vtGame.engine; let n = 0; const id = setInterval(() => { try { e.step(0.05); } catch (x) { clearInterval(id); } if (++n >= 24) clearInterval(id); }, 40); }"

RECT_JS = "(sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; }"


def zero_ui(s, where: str, docked: bool = False) -> None:
    s.page.wait_for_timeout(450)  # the reticle fades over 0.25 s
    res = s.page.evaluate(ZERO_UI_JS)
    if res.get("error"):
        s.check(False, f"{where}: {res['error']}")
        return
    s.check(not res["stray"], f"{where}: visible elements outside the world: {res['stray']}")
    s.check(res["layers"] == ["vtg-css", "vtg-canvas", "vtg-reticle"], f"{where}: the game root holds other layers than the world and the reticle: {res['layers']}")
    s.check(not res["frame"], f"{where}: app frame elements exist in the ship: {res['frame']}")
    s.check(res["toasts"] == 0, f"{where}: {res['toasts']} toast(s) visible in screen space")
    s.check(res["modals"] == 0, f"{where}: {res['modals']} dialog(s) outside an in-world screen")
    ret = res["reticle"]
    s.check(ret is not None, f"{where}: no reticle")
    if ret:
        s.check(ret["w"] <= 20 and ret["h"] <= 20, f"{where}: the reticle is {ret['w']}x{ret['h']} px")
        s.check(abs(ret["cx"] - res["vw"] / 2) <= 1.5 and abs(ret["cy"] - res["vh"] / 2) <= 1.5, f"{where}: the reticle is not at the centre")
        s.check((float(ret["opacity"]) == 0) == docked, f"{where}: reticle opacity {ret['opacity']} while {'docked' if docked else 'walking'}")


def scenario_shell(s, h) -> None:
    parts = [p for p in os.environ.get("SHELL_PARTS", "boot,terminals,dialogs,fallback").split(",") if p]
    if "boot" in parts:
        part_boot(s, h)
    if "terminals" in parts:
        part_terminals(s, h)
    if "dialogs" in parts:
        part_dialogs(s, h)
    if "fallback" in parts:
        part_fallback(s, h)


# --------------------------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------------------------


def docked_id(h, pg):
    return h.V(pg, "g.engine.screens.docked && g.engine.screens.docked.id")


def settle(h, pg, n: int = 30) -> None:
    """Advance the stopped engine (a dock flight is 0.7 s) and draw one frame."""
    h.game_steps(pg, n)


def engage(s, h, tid: str) -> str:
    """Walk up to a terminal, look at it, press E, and wait for its real page."""
    pg = s.page
    if h.V(pg, "g.engine.screens.busy"):  # a failed step left a screen engaged
        pg.evaluate("() => window.__vtGame.engine.screens.undock()")
        settle(h, pg)
    s.check(pg.evaluate("(id) => window.__vtGame.goToTerminal(id)", tid) is True, f"{tid}: no such terminal on the deck")
    settle(h, pg, 3)
    focused = h.V(pg, "g.engine.interact.focused && g.engine.interact.focused.id")
    s.check(focused == f"screen:svc-{tid}", f"{tid}: looking at the terminal focuses '{focused}'")
    s.check(pg.locator(f"[data-screen='svc-{tid}'] [data-vtg-term-idle]").count() == 1, f"{tid}: no idle face before engaging")
    s.check(pg.locator(f"[data-vtg-term-page={tid}]").count() == 0, f"{tid}: the page is mounted while the terminal is idle")
    pg.keyboard.press("KeyE")
    settle(h, pg)
    s.check(docked_id(h, pg) == f"svc-{tid}", f"{tid}: E did not engage the terminal (docked: {docked_id(h, pg)})")
    scope = f"[data-vtg-term-page={tid}]"
    pg.wait_for_selector(scope, state="attached", timeout=60000)
    return scope


def disengage(s, h, tid: str) -> None:
    pg = s.page
    if docked_id(h, pg) is None and not h.V(pg, "g.engine.screens.busy"):
        return
    pg.keyboard.press("Escape")
    settle(h, pg)
    s.check(not h.V(pg, "g.engine.screens.busy"), f"{tid}: Esc did not disengage (docked: {docked_id(h, pg)})")
    s.check(pg.locator(f"[data-vtg-term-page={tid}]").count() == 0, f"{tid}: the page stays mounted after disengaging")


def on_screen(s, h, tid: str, what: str) -> None:
    """The docked terminal is square on, inside the window, at the DOM's own resolution."""
    pg = s.page
    r = pg.evaluate(RECT_JS, f"[data-screen='svc-{tid}']")
    vw, vh = pg.evaluate("() => [innerWidth, innerHeight]")
    s.check(r and r["x"] >= -1 and r["y"] >= -1 and r["r"] <= vw + 1 and r["b"] <= vh + 1, f"{what}: the docked screen is not inside the window: {r}")
    if r:
        px = pg.evaluate("(sel) => document.querySelector(sel).offsetWidth", f"[data-screen='svc-{tid}']")
        s.check(abs(r["w"] / px - 1) < 0.2, f"{what}: the docked DOM is scaled {r['w'] / px:.2f}x (layout {px}px, shown {r['w']:.0f}px)")
        s.check(r["w"] >= vw * 0.75, f"{what}: the docked screen only covers {r['w']:.0f} of {vw}px")


def floats_near(s, h, tid: str, float_sel: str, ref_sel: str, what: str) -> None:
    """A dropdown / picker / tooltip opened on a docked screen sits on that screen, by its control."""
    pg = s.page
    try:
        pg.locator(float_sel).first.wait_for(state="visible", timeout=20000)
    except Exception:  # noqa: BLE001
        s.check(False, f"{what}: did not open ({float_sel})")
        return
    pg.wait_for_timeout(400)
    box = lambda loc: (lambda b: {"x": b["x"], "y": b["y"], "w": b["width"], "h": b["height"], "r": b["x"] + b["width"], "b": b["y"] + b["height"]} if b else None)(loc.first.bounding_box())
    f = box(pg.locator(float_sel))
    r = box(pg.locator(ref_sel))
    scr = box(pg.locator(f"[data-screen='svc-{tid}']"))
    s.check(pg.locator(float_sel).first.evaluate("(el, sel) => !!el.closest(sel)", f"[data-screen='svc-{tid}']"), f"{what}: opened outside its screen (in screen space)")
    if not (f and r and scr):
        s.check(False, f"{what}: could not measure ({f}, {r})")
        return
    s.check(f["x"] >= scr["x"] - 2 and f["r"] <= scr["r"] + 2 and f["y"] >= scr["y"] - 2 and f["b"] <= scr["b"] + 2, f"{what}: not inside the docked screen: {f} vs {scr}")
    gap_y = max(f["y"] - r["b"], r["y"] - f["b"], 0)
    gap_x = max(f["x"] - r["r"], r["x"] - f["r"], 0)
    s.check(gap_y <= 40 and gap_x <= 40, f"{what}: {gap_x:.0f}px / {gap_y:.0f}px away from its control: {f} vs {r}")


def on_comms(s, h, what: str) -> None:
    pg = s.page
    # the router takes the dialog as soon as Mantine mounts it; draw the display so it can open
    pg.wait_for_function("() => window.__vtGame && window.__vtGame.modals.isOpen", timeout=60000, polling=250)
    settle(h, pg)
    pg.wait_for_selector(".mantine-Modal-content", state="attached", timeout=60000)
    settle(h, pg, 4)
    s.check(h.V(pg, "g.modals.isOpen") is True, f"{what}: the modal router did not take the dialog")
    s.check(pg.evaluate("() => !!document.querySelector('[data-screen=comms] .mantine-Modal-content')"), f"{what}: the dialog is not inside the Comms display")
    s.check(docked_id(h, pg) == "comms", f"{what}: Comms is not engaged (docked: {docked_id(h, pg)})")
    m = pg.evaluate(RECT_JS, "[data-screen=comms] .mantine-Modal-content")
    c = pg.evaluate(RECT_JS, "[data-screen=comms]")
    vw, vh = pg.evaluate("() => [innerWidth, innerHeight]")
    s.check(m and c and m["x"] >= c["x"] - 2 and m["r"] <= c["r"] + 2 and m["y"] >= c["y"] - 2 and m["b"] <= c["b"] + 2, f"{what}: the dialog is larger than the Comms display: {m} vs {c}")
    s.check(c and c["x"] >= -1 and c["y"] >= -1 and c["r"] <= vw + 1 and c["b"] <= vh + 1, f"{what}: the Comms display is not inside the window: {c}")


def comms_closed(s, h, what: str, back_to: str | None) -> None:
    pg = s.page
    pg.wait_for_selector(".mantine-Modal-content", state="detached", timeout=30000)
    settle(h, pg)
    s.check(h.V(pg, "g.modals.isOpen") is False, f"{what}: Comms still open")
    s.check(docked_id(h, pg) == back_to, f"{what}: after the dialog, docked is {docked_id(h, pg)} (expected {back_to})")
    s.check(pg.evaluate("() => document.querySelector('[data-mantine-shared-portal-node]').parentElement === document.body"), f"{what}: portal node not back in <body>")


def note_text(pg) -> str:
    return pg.evaluate("() => [...document.querySelectorAll('[data-vtg-term-note]')].map((n) => n.textContent).join(' | ')")


# --------------------------------------------------------------------------------------------
# parts
# --------------------------------------------------------------------------------------------


def part_boot(s, h) -> None:
    with s.step("shell: boot lands in the world with nothing in screen space but the reticle"):
        pg = s.open(*h.DEFAULT_WINDOW, storage=h.SHIP)
        h.wait_game(s)
        s.check(pg.locator("canvas.vtg-canvas").count() == 1, "no game canvas")
        s.check(h.V(pg, "g.where") == "vault", "did not start in the vault")
        zero_ui(s, "boot")
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") != "1", "the ship fell back to the classic view")

    with s.step("shell: a toast is announced in the world, not in screen space"):
        pg.evaluate("() => window.__vtGame.engine.events.emit('debug', 'notify')")
        pg.wait_for_function("() => (document.querySelector('[data-vtg-pa-latest]') || {}).textContent?.includes('Test notification')", timeout=30000)
        s.check(pg.evaluate("() => document.querySelectorAll('.mantine-Notification-root').length") >= 1, "the app's own notification was not created")
        zero_ui(s, "with a toast up")

    with s.step("shell: the Service Deck stands along the south windows, one idle terminal per section"):
        pg.evaluate("() => { const g = window.__vtGame; g.place(0, 4.2, Math.PI); g.engine.player.pitch = -0.04; }")
        settle(h, pg, 6)
        ids = pg.evaluate("() => window.__vtGame.deck.terminals.map((t) => t.info.id)")
        s.check(sorted(ids) == sorted(["live", "market", "chat", "analytics", "cargo", "messages", "home", "settings", "account", "about", "debug"]), f"terminals on the deck: {ids}")
        s.check(pg.locator("[data-vtg-term-idle]").count() == len(ids), "not every terminal shows its idle face")
        s.check(pg.locator("[data-vtg-term-page]").count() == 0, "a page is mounted on an idle terminal")
        # idle screens must not animate or scroll (they would re-composite every in-world layer)
        busy = pg.evaluate(
            """() => [...document.querySelectorAll('.vtg-screen.vtg-term:not(.is-docked) *')].filter((el) => { const cs = getComputedStyle(el);
                 return (cs.animationName !== 'none' && cs.animationIterationCount === 'infinite') || ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1); }).length"""
        )
        s.check(busy == 0, f"{busy} animated or scrolling element(s) on idle terminals")
        zero_ui(s, "at the deck")

    with s.step("shell: the Bridge Watch shows the ship's clock and the alerts; an alert link opens"):
        pg.evaluate("() => { const g = window.__vtGame; g.place(-3.2, 2.4, 0); g.aimAt(...g.deck.watch.center.toArray()); }")
        settle(h, pg, 4)
        focused = h.V(pg, "g.engine.interact.focused && g.engine.interact.focused.id")
        s.check(focused == "screen:svc-watch", f"looking at the Bridge Watch focuses '{focused}'")
        clock = pg.locator("[data-vtg-watch-clock]").inner_text()
        s.check(len(re.findall(r"\d\d:\d\d:\d\d", clock)) >= 2, f"clock (UTC and time to reset) not shown: {clock!r}")
        s.check(h.text_visible(pg, "[data-vtg-watch-alerts]", "Mock alert: warframe.market maintenance"), "alert text missing")
        pg.keyboard.press("KeyE")
        settle(h, pg)
        s.check(docked_id(h, pg) == "svc-watch", "E did not engage the Bridge Watch")
        zero_ui(s, "watch docked", docked=True)
        pg.locator("[data-vtg-alert][data-clickable]").first.click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("() => window.__HARNESS__.calls.some((c) => c.cmd === 'plugin:shell|open')", timeout=15000)
        opened = h.calls(pg, "plugin:shell|open")
        s.check("example.invalid/notes" in str(opened[-1]["args"]), f"alert link opened {opened[-1]['args']}")
        pg.keyboard.press("Escape")
        settle(h, pg)
        s.check(not h.V(pg, "g.engine.screens.busy"), "Esc did not disengage the Bridge Watch")


def fresh(s, h):
    """A new session in the ship. The software-rendered page grows by hundreds of megabytes with
    every heavy page it has shown, and the machine's memory is shared with other runs: a few
    terminals per session keep the renderer from being killed."""
    with s.step("shell: a fresh session in the ship", shot=False):
        pg = s.open(*h.DEFAULT_WINDOW, storage=h.SHIP)
        h.wait_game(s)
    return pg


def part_terminals(s, h) -> None:
    pg = fresh(s, h)
    H, calls, text_visible = h.H, h.calls, h.text_visible

    # --- Trade Engine: the Live Trading page, with the trader start/stop and the strategy panel
    with s.step("shell: Trade Engine docks and shows the real Live Trading page"):
        scope = engage(s, h, "live")
        s.check(text_visible(pg, scope, "Glaive Prime Set", timeout=60000), "stock items missing")
        s.check(text_visible(pg, scope, "net worth"), "strategy panel missing")
        on_screen(s, h, "live", "Trade Engine")
        zero_ui(s, "Trade Engine docked", docked=True)
        h.layout(s, scope, "Trade Engine")
    with s.step("shell: Trade Engine starts the live trader; the confirmation is asked on the Comms display"):
        pg.evaluate("() => { document.querySelector('[data-vtg-term-page=live]').dataset.mark = 'kept'; }")
        pg.locator(scope).get_by_role("button", name="Start", exact=False).first.evaluate(OPEN_JS)
        on_comms(s, h, "start confirmation")
        s.check(H(pg, "h.state.running") is False, "the trader started before the confirmation")
        s.check(pg.locator("[data-vtg-term-page=live]").count() == 1, "the page was unmounted while its dialog is open")
        zero_ui(s, "confirmation on Comms", docked=True)
    with s.step("shell: confirming starts the trader and returns to the terminal, page intact"):
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Start", exact=False).first.click(timeout=30000, no_wait_after=True)
        comms_closed(s, h, "start confirmation", "svc-live")
        pg.wait_for_function("() => window.__HARNESS__.state.running === true", timeout=15000)
        s.check(pg.evaluate("() => document.querySelector('[data-vtg-term-page=live]')?.dataset.mark") == "kept", "the page was remounted by its own dialog")
        s.check(text_visible(pg, scope, "Stop", timeout=20000), "the page does not show the trader running")
        pg.locator(scope).get_by_role("button", name="Stop", exact=False).first.click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("() => window.__HARNESS__.state.running === false", timeout=15000)
    with s.step("shell: Trade Engine strategy: pick a preset"):
        pg.locator(scope).get_by_role("button", name="Show presets and activity").click(timeout=30000, no_wait_after=True)
        pg.locator(f"{scope} button[aria-pressed]", has_text="Flipper").click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("() => window.__HARNESS__.state.settings.live_scraper.void_trader.preset === 'flipper'", timeout=15000)
        pg.locator(scope).get_by_role("button", name="Hide presets", exact=False).first.click(timeout=30000, no_wait_after=True)
    with s.step("shell: Trade Engine: a tooltip and a dropdown open on the docked screen, at their controls"):
        row = pg.locator(f"{scope} tbody tr", has_text="Nova Prime Set").first
        actions = row.locator("td").last.locator("button")
        btn = actions.first
        btn.evaluate("(el) => el.setAttribute('data-harness-ref', 'tip')")
        btn.hover(timeout=30000)
        floats_near(s, h, "live", ".mantine-Tooltip-tooltip", "[data-harness-ref=tip]", "tooltip")
        pg.mouse.move(5, 5)
        pg.wait_for_timeout(400)
        sel = pg.locator(f"{scope} input[placeholder='Select item...']").first
        sel.evaluate("(el) => el.setAttribute('data-harness-ref', 'select')")
        sel.click(timeout=30000, no_wait_after=True)
        floats_near(s, h, "live", "[role=listbox]:visible, .mantine-Select-dropdown:visible, .mantine-Combobox-dropdown:visible", "[data-harness-ref=select]", "item select dropdown")
    with s.step("shell: Trade Engine: an option picked from the dropdown lands in the field"):
        opt = pg.locator("[role=option]:visible").first
        name = opt.inner_text().strip().split("\n")[0]
        opt.click(timeout=30000, no_wait_after=True)
        pg.wait_for_timeout(500)
        s.check(name and name.lower() in (sel.input_value() or "").lower(), f"picked '{name}', the field shows '{sel.input_value()}'")
    pg = fresh(s, h)
    with s.step("shell: Trade Engine: a row's sell dialog opens on Comms and the sale reaches the backend"):
        scope = engage(s, h, "live")
        s.check(text_visible(pg, scope, "Nova Prime Set", timeout=60000), "stock items missing")
        row = pg.locator(f"{scope} tbody tr", has_text="Nova Prime Set").first
        actions = row.locator("td").last.locator("button")
        before = len(calls(pg, "stock_item_sell"))
        actions.first.evaluate(OPEN_JS)
        on_comms(s, h, "sell dialog")
        fields = pg.locator(".mantine-Modal-content input:not([type=hidden])")
        fields.nth(0).fill("1")
        fields.nth(1).fill("77")
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Confirm", exact=False).first.click(timeout=30000, no_wait_after=True)
        comms_closed(s, h, "sell dialog", "svc-live")
        pg.wait_for_function("(n) => window.__HARNESS__.calls.filter((c) => c.cmd === 'stock_item_sell').length > n", arg=before, timeout=15000)
        sold = calls(pg, "stock_item_sell")[-1]
        s.check("77" in str(sold["args"]), f"sale sent as {sold['args']}")
        s.check("error" not in sold, f"the backend would reject the sale: {sold.get('error')}")
        pg.wait_for_timeout(600)
        s.check("77" in note_text(pg) or len(note_text(pg)) > 0, "the result toast is not shown on the docked terminal")
        disengage(s, h, "live")

    # --- the other page terminals: (id, name, proof, control, proof after, command that must have been called)
    table = [
        ("market", "Order Relay", "Sell Order", ("tab", "Auctions"), "Critacan", None),
        ("chat", "Courier Inbox", "VoidRunner77", ("text", "PlatBaron"), "450 is the lowest I can go.", None),
        ("analytics", "Ledger", "Created At", ("tab", "Riven"), "Rubico", None),
        ("cargo", "Cargo Scanner", "SELL FINDER", ("tab", "Rivens"), "Catchmoon", "vt_sell_finder"),
        ("messages", "Broadcast Composer", "Glaive Prime Set", ("tab", "Custom"), "Carry service", None),
        ("home", "Overview", "Total Profit", ("text", "Sale"), "Last Transaction", None),
        ("debug", "Maintenance Hatch", "Add Log", ("tab", "States"), "WFM State", None),
    ]
    for i, (tid, name, proof, control, after, cmd) in enumerate(table):
        if i % 3 == 2:
            pg = fresh(s, h)
        with s.step(f"shell: {name} docks, shows the real page, and a control round-trips"):
            n0 = H(pg, "h.calls.length")
            scope = engage(s, h, tid)
            s.check(text_visible(pg, scope, proof, timeout=60000), f"the real page did not render (expected '{proof}')")
            s.check(pg.locator("[data-vtg-term-fault]").count() == 0, "the terminal shows a fault")
            on_screen(s, h, tid, name)
            kind, what = control
            if kind == "tab":
                pg.locator(scope).get_by_role("tab", name=what, exact=False).first.click(timeout=30000, no_wait_after=True)
            else:
                pg.locator(scope).get_by_text(what, exact=False).first.click(timeout=30000, no_wait_after=True)
            s.check(text_visible(pg, scope, after, timeout=30000), f"using '{what}' did not work (expected '{after}')")
            s.check(H(pg, "h.calls.length") > n0, "no backend command was called from the terminal")
            if cmd:
                s.check(len(calls(pg, cmd)) >= 1, f"{cmd} never called")
            zero_ui(s, f"{name} docked", docked=True)
            h.layout(s, scope, name)
            if tid == "analytics":
                # a date picker on the docked screen: opens at its button and picks a range
                pg.locator(scope).get_by_role("tab", name="Item", exact=False).first.click(timeout=30000, no_wait_after=True)
                pg.wait_for_timeout(500)
                btn = pg.locator(f"{scope} button", has_text="Select date range").first
                btn.evaluate("(el) => el.setAttribute('data-harness-ref', 'dates')")
                btn.click(timeout=30000, no_wait_after=True)
                floats_near(s, h, tid, ".mantine-Popover-dropdown:visible", "[data-harness-ref=dates]", "date picker")
                days = pg.locator(".mantine-Popover-dropdown .mantine-DatePickerInput-day:not([data-outside]):not([disabled])")
                days.nth(1).click(timeout=30000, no_wait_after=True)
                days.nth(8).click(timeout=30000, no_wait_after=True)
                pg.wait_for_timeout(800)
                s.check("Select date range" not in pg.locator("[data-harness-ref=dates]").inner_text(), "the picked range did not land in the field")
                pg.keyboard.press("Escape")  # closes the picker (and disengages if it was already closed)
                pg.wait_for_timeout(300)
                if docked_id(h, pg) is None:
                    settle(h, pg)
            disengage(s, h, tid)

    pg = fresh(s, h)
    with s.step("shell: Ship's Registry (About): check for updates answers on the terminal", allow=[r"plugin:process"]):
        scope = engage(s, h, "about")
        s.check(text_visible(pg, scope, "Check for Updates", timeout=60000), "About page missing")
        s.check(text_visible(pg, scope, "Version"), "version missing")
        n0 = len(calls(pg, "plugin:updater|check"))
        pg.locator(scope).get_by_role("button", name="Check for Updates", exact=False).first.click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("(n) => window.__HARNESS__.calls.filter((c) => c.cmd === 'plugin:updater|check').length > n", arg=n0, timeout=15000)
        pg.wait_for_function("() => [...document.querySelectorAll('[data-vtg-term-note]')].some((n) => /no updates/i.test(n.textContent))", timeout=15000)
        zero_ui(s, "About docked with its toast", docked=True)
        disengage(s, h, "about")

    with s.step("shell: Engineering (settings): every tab is there; a change is saved through the backend"):
        scope = engage(s, h, "settings")
        s.check(text_visible(pg, scope, "Live Scraper", timeout=60000), "settings form missing")
        pg.locator(f"{scope} [role=tab]", has_text="Notifications").first.click(timeout=30000, no_wait_after=True)
        s.check(text_visible(pg, scope, "Conversation"), "notification settings missing")
        on_screen(s, h, "settings", "Engineering")
        before = len(calls(pg, "app_update_settings"))
        was = H(pg, "h.state.settings.live_scraper.general.report_to_wfm")
        h.change_a_setting(pg, scope)
        pg.locator(scope).get_by_role("button", name="Save", exact=False).last.click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("(n) => window.__HARNESS__.calls.filter((c) => c.cmd === 'app_update_settings').length > n", arg=before, timeout=15000)
        s.check(H(pg, "h.state.settings.live_scraper.general.report_to_wfm") is (not was), "the changed setting did not reach the backend")
        s.check("error" not in calls(pg, "app_update_settings")[-1], "the backend would reject the settings")
        try:
            pg.wait_for_function("() => !window.__vtGame.engine.screens.docked", timeout=15000, polling=250)
        except Exception:  # noqa: BLE001
            pass
        settle(h, pg)
        s.check(not h.V(pg, "g.engine.screens.busy"), "the terminal did not disengage after saving")
        pg.wait_for_function("() => /settings/i.test((document.querySelector('[data-vtg-pa-latest]') || {}).textContent || '')", timeout=15000)

    with s.step("shell: Captain's Console: market status is set through the backend"):
        scope = engage(s, h, "account")
        s.check(text_visible(pg, scope, "VoidTraderTester", timeout=60000), "account name missing")
        before = len(calls(pg, "user_set_status"))
        pg.locator("[data-vtg-account] [data-user-status='online']").click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("(n) => window.__HARNESS__.calls.filter((c) => c.cmd === 'user_set_status').length > n", arg=before, timeout=15000)
        s.check("online" in str(calls(pg, "user_set_status")[-1]["args"]), "status not sent")
        zero_ui(s, "Captain's Console docked", docked=True)
    with s.step("shell: Captain's Console: log out asks on Comms, then shows the login page"):
        pg.locator("[data-vtg-logout]").evaluate(OPEN_JS)
        on_comms(s, h, "log out confirmation")
        s.check(H(pg, "h.state.user.anonymous") is False, "logged out before confirming")
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Yes").click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("() => location.pathname === '/auth/login'", timeout=30000)
        s.check(len(calls(pg, "auth_logout")) == 1, "auth_logout not called")
        pg.wait_for_selector("input[type=password]", timeout=30000)
        s.check(pg.locator("[data-vtg-host]").count() == 0, "the game is still mounted after logging out")
        s.check(pg.evaluate("() => { const n = document.querySelector('[data-mantine-shared-portal-node]'); return !n || n.parentElement === document.body; }"), "portal node lost on logout")


def part_dialogs(s, h) -> None:
    with s.step("shell: the terms of service appear in the world, on the Comms display"):
        pg = s.open(*h.DEFAULT_WINDOW, options={"tosAccepted": False}, storage=h.SHIP)
        h.wait_game(s)
        on_comms(s, h, "terms of service")
        s.check(h.text_visible(pg, "[data-screen=comms] .mantine-Modal-content", "Data Protection Policy", timeout=30000), "terms text not shown")
        zero_ui(s, "terms on Comms", docked=True)
    with s.step("shell: Esc does not dismiss the terms (they must be answered), accepting reaches the backend"):
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(600)
        settle(h, pg)
        s.check(pg.locator("[data-screen=comms] .mantine-Modal-content").count() == 1, "Esc dismissed the terms of service")
        s.check(docked_id(h, pg) == "comms", f"Esc left the terms unanswered and out of view (docked: {docked_id(h, pg)})")
        s.check(len(h.calls(pg, "app_accept_tos")) == 0, "accepted without the owner")
        box = pg.locator(".mantine-Modal-content .mantine-ScrollArea-viewport").first
        if box.count():
            box.evaluate("(el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); }")
            pg.wait_for_timeout(400)
        pg.locator(".mantine-Modal-content button").last.click(timeout=30000, no_wait_after=True)
        pg.wait_for_function("() => window.__HARNESS__.calls.some((c) => c.cmd === 'app_accept_tos' || c.cmd === 'app_exit')", timeout=15000)
        s.check(len(h.calls(pg, "app_accept_tos")) == 1, "accepting did not reach the backend")
        comms_closed(s, h, "terms of service", None)
        zero_ui(s, "after the terms")

    with s.step("shell: the update dialog appears in the world, on the Comms display"):
        pg = s.open(*h.DEFAULT_WINDOW, options={"updateAvailable": True}, storage=h.SHIP)
        h.wait_game(s)
        on_comms(s, h, "update available")
        s.check(h.text_visible(pg, "[data-screen=comms] .mantine-Modal-content", "1.13.0", timeout=30000), "new version not shown")
        s.check(pg.locator("[data-screen=comms] .mantine-Modal-content button").count() >= 1, "no button on the update dialog")
        zero_ui(s, "update on Comms", docked=True)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(600)
        settle(h, pg)
        s.check(pg.locator("[data-screen=comms] .mantine-Modal-content").count() == 1 and docked_id(h, pg) == "comms", "Esc dismissed the update dialog (it is not dismissable in the classic view either)")


def part_fallback(s, h) -> None:
    crash = [r"test fault", r"\[game\]", r"\[shell\]", r"The above error occurred", r"React will try to recreate", r"error boundary", r"An error occurred in", r"Unhandled error"]
    main = ".mantine-AppShell-main"
    with s.step("shell: a crash of the game opens the classic view, with the full app frame", allow=crash):
        pg = s.open(*h.DEFAULT_WINDOW, storage=h.SHIP)
        h.wait_game(s)
        zero_ui(s, "before the crash")
        pg.evaluate("() => window.__vtGame.crash()")
        pg.wait_for_selector("nav button", timeout=60000)
        pg.wait_for_selector("[data-vtg-host]", state="detached", timeout=20000)
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") == "1", "the fallback was not remembered")
        s.check("crash" in (pg.evaluate("() => localStorage.getItem('vt_classic_reason')") or ""), "no fallback reason recorded")
        s.check(pg.locator("header").count() >= 1 and pg.locator("nav button").count() >= 9, "the classic frame (header, side bar) is incomplete")
        s.check(h.text_visible(pg, "body", "The ship could not start"), "the owner is not told what happened")
        body = pg.evaluate("() => document.body.innerText")
        s.check("Unexpected Application Error" not in body and "hit an error" not in body, "an error page is shown")
        s.check(pg.evaluate("() => { const n = document.querySelector('[data-mantine-shared-portal-node]'); return !n || n.parentElement === document.body; }"), "portal node lost in the crash")
        s.check(pg.evaluate("() => !document.querySelector('style[data-vtg-notifications]')"), "toasts are still hidden after the game is gone")
    with s.step("shell: in the fallback the trades are reachable and work"):
        h.close_notifications(pg)
        pg.set_default_timeout(10000)
        h.nav(s, "live_scraper")
        s.check(h.text_visible(pg, main, "Glaive Prime Set"), "stock items missing in the classic view")
        h.nav(s, "warframe_market")
        s.check(h.text_visible(pg, main, "Sell Order"), "market orders missing in the classic view")
        h.nav(s, "home")
        s.check(h.text_visible(pg, main, "Total Profit"), "Home missing in the classic view")
    with s.step("shell: the next launch opens the classic view too"):
        pg.reload()
        h.wait_app(s)
        s.check(pg.locator("[data-vtg-host]").count() == 0 and pg.locator("nav button").count() >= 9, "the fallback was forgotten on reload")
        h.close_notifications(pg)
    with s.step("shell: 'Return to the ship' in the classic view goes back to the game and forgets the fallback"):
        pg.locator("nav button:has([data-vt-return-ship])").click()
        h.wait_game(s)
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") == "0" and pg.evaluate("() => localStorage.getItem('vt_classic_reason')") is None, "the fallback is still remembered")
        zero_ui(s, "back in the ship")
    with s.step("shell: the key chord (Ctrl+Shift+F12) toggles to the classic view"):
        pg.keyboard.press("Control+Shift+F12")
        pg.wait_for_selector("[data-vtg-host]", state="detached", timeout=20000)
        pg.wait_for_selector("nav button", timeout=30000)
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") == "1", "chord did not switch to classic")
        s.check(pg.evaluate("() => !window.__vtGame && !document.querySelector('.vtg-root')"), "game DOM or handle left behind")
        s.check(h.text_visible(pg, main, "Total Profit", timeout=20000), "classic Home did not render after the chord")
        s.check(not h.text_visible(pg, "body", "The ship could not start", timeout=1500), "the crash notice is shown for a deliberate switch")
    with s.step("shell: the key chord toggles back to the ship; the choice survives a reload"):
        pg.keyboard.press("Control+Shift+F12")
        h.wait_game(s)
        zero_ui(s, "after the chord")
        pg.reload()
        h.wait_game(s)
        s.check(pg.locator("nav button").count() == 0, "classic view after reloading in the ship")
        zero_ui(s, "after a reload in the ship")
