#!/usr/bin/env python3
"""Void Trader browser harness: runs the real frontend against a mocked Tauri backend.

    python3 tools/harness/run.py                 # full suite on the Vite dev server + smoke on dist/
    python3 tools/harness/run.py --only station  # one scenario (boot, classic, station, fp, layout, remount, dist)
    python3 tools/harness/run.py --shots DIR     # where screenshots go

See README.md next to this file.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import HERE, ROOT, Server, Suite  # noqa: E402
import scenarios_shell  # noqa: E402
from scenarios_audio import scenario_audio  # noqa: E402

DEFAULT_SHOTS = HERE / "shots"

# The logged-in app is the 3D game; the classic view is its hidden fallback (src/game/shellMode.ts).
# Every session opens in the classic fallback unless a scenario asks for the ship with SHIP.
CLASSIC = {"vt_classic_mode": "1"}
SHIP = {"vt_classic_mode": "0", "vt_game_quality": "low", "vt_game_view": "first", "vt_game_watchdog_ms": "600000"}

NAV = ["ship", "station", "home", "live_scraper", "warframe_market", "chat", "trading_analytics", "wf_inventory", "trade_messages", "debug", "about"]
PATHS = {"station": "/station", "home": "/", "live_scraper": "/live_scraper", "warframe_market": "/warframe-market", "chat": "/chat", "trading_analytics": "/trading_analytics", "wf_inventory": "/wf_inventory", "trade_messages": "/trade_messages", "debug": "/debug", "about": "/about"}

# What each station terminal must show: (panel id, map entry, text that proves the real page rendered,
# a control to use inside it, text/selector that proves the control worked)
PANELS = [
    ("ledger", "Ledger terminal", "Created At", ("tab", "Riven"), "Rubico"),
    ("scanner", "Cargo scanner", "SELL FINDER", ("tab", "Rivens"), "Catchmoon"),
    ("about", "Info plaque", "Check for Updates", ("button", "Check for Updates"), "No updates available"),
    ("overview", "Overview screen", "Total Profit", ("text", "Sale"), "Last Transaction"),
    ("comms", "Comms terminal", "VoidRunner77", ("text", "PlatBaron"), "450 is the lowest I can go."),
    ("tradechat", "Trade chat terminal", "Glaive Prime Set", ("tab", "Custom"), "Carry service"),
    ("engineering", "Engineering terminal", "Live Scraper", ("tab", "Notifications"), "Conversation"),
    ("captain", "Captain's console", "VoidTraderTester", ("css", "[data-station-captain] [data-user-status='online']"), None),
    ("debug", "Maintenance hatch", "Add Log", ("tab", "States"), "WFM State"),
    ("live", "Stock desk", "Glaive Prime Set", ("tab", "Riven"), "Rubico"),
    ("market", "Market terminal", "Sell Order", ("tab", "Auctions"), "Critacan"),
]

# --------------------------------------------------------------------------------------------
# in-page helpers
# --------------------------------------------------------------------------------------------

LAYOUT_JS = r"""
([rootSel, opts]) => {
  // Finds controls and text that the user can neither see nor scroll to:
  //  - cut by an ancestor that hides overflow (and no scrollable ancestor in between),
  //  - below/right of the viewport with nothing scrollable above it,
  //  - covered by another element (e.g. the alert ticker).
  const root = document.querySelector(rootSel);
  if (!root) return { error: 'root not found: ' + rootSel, issues: [] };
  const vw = innerWidth, vh = innerHeight;
  const issues = [];
  const scrolls = (el, axis) => {
    const cs = getComputedStyle(el);
    const o = axis === 'y' ? cs.overflowY : cs.overflowX;
    return (o === 'auto' || o === 'scroll') && (axis === 'y' ? el.scrollHeight > el.clientHeight + 1 : el.scrollWidth > el.clientWidth + 1);
  };
  const hides = (v) => v === 'hidden' || v === 'clip';
  const describe = (el) => {
    const t = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/).filter(Boolean).slice(0, 2).join('.') : '') + (t ? ' "' + t + '"' : '');
  };
  const skip = opts.skip || [];
  const els = root.querySelectorAll('button, input:not([type=hidden]), textarea, a[href], [role=tab], th, td, label, canvas, h1, h2, h3, h4, .mantine-Text-root, .mantine-Badge-root, .mantine-Paper-root');
  for (const el of els) {
    if (skip.some((s) => el.closest(s))) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0 || cs.pointerEvents === 'none' && el.tagName === 'INPUT') continue;
    if (el.tagName === 'INPUT' && (el.type === 'checkbox' || el.type === 'radio') ) continue;
    let node = el.parentElement, scrollY = false, scrollX = false, hiddenAncestor = false, cut = null;
    while (node && node !== document.documentElement) {
      const s = getComputedStyle(node);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) { hiddenAncestor = true; break; }
      const nr = node.getBoundingClientRect();
      if (scrolls(node, 'y')) scrollY = true;
      if (scrolls(node, 'x')) scrollX = true;
      if (!cut && !scrollY && hides(s.overflowY) && (r.bottom > nr.bottom + 3 || r.top < nr.top - 3) && nr.height > 0) cut = 'vertically cut by ' + describe(node).slice(0, 60);
      if (!cut && !scrollX && hides(s.overflowX) && s.textOverflow !== 'ellipsis' && cs.textOverflow !== 'ellipsis' && (r.right > nr.right + 3 || r.left < nr.left - 3) && nr.width > 0) cut = 'horizontally cut by ' + describe(node).slice(0, 60);
      node = node.parentElement;
    }
    if (hiddenAncestor) continue;
    if (!cut && !scrollY && r.bottom > vh + 3) cut = 'below the window (bottom ' + Math.round(r.bottom) + ' > ' + vh + ')';
    if (!cut && !scrollX && r.right > vw + 3) cut = 'right of the window (right ' + Math.round(r.right) + ' > ' + vw + ')';
    if (!cut && r.top >= 0 && r.bottom <= vh && r.left >= 0 && r.right <= vw && !scrollY && !scrollX) {
      // fully in view and not in a scroller: it must not be covered
      const x = Math.min(vw - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(vh - 1, Math.max(0, r.top + r.height / 2));
      const top = document.elementFromPoint(x, y);
      if (top && top !== el && !el.contains(top) && !top.contains(el)) {
        const tcs = getComputedStyle(top);
        // siblings laid over each other on purpose (labels inside inputs, badges) share a small parent
        const common = top.parentElement && (top.parentElement.contains(el));
        const big = top.closest(opts.coverers || '.none');
        if (big) cut = 'covered by ' + describe(big).slice(0, 60);
        else if (!common && tcs.pointerEvents !== 'none' && !top.closest(rootSel)) cut = 'covered by ' + describe(top).slice(0, 60);
      }
    }
    if (cut) issues.push(describe(el) + ' -> ' + cut);
  }
  // de-duplicate nested reports
  return { issues: [...new Set(issues)].slice(0, 25), count: issues.length };
}
"""


def layout(s: Suite, root: str, what: str, skip: list[str] | None = None) -> None:
    pg = s.page
    pg.mouse.move(700, 30)  # away from tooltips
    pg.wait_for_timeout(250)
    res = pg.evaluate(LAYOUT_JS, [root, {"skip": (skip or []) + ["[class*=tickerContent]", ".mantine-Tooltip-tooltip", ".mantine-Notifications-root", ".mantine-datatable-empty-state"], "coverers": "[class*=newsTicker], .vt-station-footer, header"}])
    if res.get("error"):
        s.check(False, f"{what}: {res['error']}")
        return
    s.check(res["count"] == 0, f"{what}: {res['count']} unreachable or covered element(s): " + " | ".join(res["issues"][:8]))


def H(pg, expr: str):
    return pg.evaluate("() => { const h = window.__HARNESS__; return %s; }" % expr)


def calls(pg, cmd: str) -> list:
    return pg.evaluate("(c) => window.__HARNESS__.calls.filter((x) => x.cmd === c)", cmd)


def G(pg, expr: str):
    return pg.evaluate("() => { const g = window.__vtStation; if (!g) return null; return %s; }" % expr)


def has_game(pg) -> bool:
    return bool(pg.evaluate("() => !!window.__vtStation"))


def wait_app(s: Suite, timeout: int = 40000) -> None:
    s.page.wait_for_selector("nav button", timeout=timeout)
    # the splash screen fades out over about four seconds and covers the app until then
    s.page.wait_for_selector("[class*=splashScreen]", state="detached", timeout=15000)
    s.page.wait_for_timeout(300)


def wait_game(s: Suite, timeout: int = 180000) -> None:
    """The ship is up: first frame drawn, splash gone. The engine is then stopped (software WebGL
    is slow; tests step it with game_steps) and a few frames are drawn."""
    pg = s.page
    pg.set_default_timeout(60000)
    pg.wait_for_function("() => window.__vtGame && window.__vtGame.firstFrame", timeout=timeout)
    pg.evaluate("() => window.__vtGame.engine.stop()")  # at once: the splash fade needs the frames
    pg.wait_for_selector("[class*=splashScreen]", state="detached", timeout=90000)
    pg.evaluate("() => window.__vtGame.engine.stop()")
    # The real game requests a frame every tick. With the engine stopped nothing does, and headless
    # Chromium then delivers the frames that Mantine's transitions (dialogs, popovers) wait for only
    # after minutes. An empty animation-frame loop keeps frames coming at almost no cost.
    pg.evaluate("() => { if (!window.__harnessPump) { window.__harnessPump = true; (function loop() { requestAnimationFrame(loop); })(); } }")
    game_steps(pg, 3)


def nav(s: Suite, target: str) -> None:
    pg = s.page
    buttons = pg.locator("nav button")
    n = buttons.count()
    order = NAV if n == len(NAV) else [x for x in NAV if x != "debug"]
    buttons.nth(order.index(target)).click()
    pg.wait_for_function("(p) => location.pathname === p", arg=PATHS[target], timeout=8000)
    if target != "station":
        # the router keeps the old page on screen until the next one is ready
        pg.wait_for_selector(".vt-station-root", state="detached", timeout=10000)
    pg.mouse.move(700, 30)
    pg.wait_for_timeout(700)


def text_visible(pg, scope: str, text: str, timeout: int = 8000) -> bool:
    try:
        pg.locator(scope).get_by_text(text, exact=False).first.wait_for(state="visible", timeout=timeout)
        return True
    except Exception:  # noqa: BLE001
        return False


def tab(pg, scope: str, name: str) -> None:
    pg.locator(scope).get_by_role("tab", name=name, exact=False).first.click()
    pg.wait_for_timeout(600)


def pick_date_range(pg, scope: str) -> None:
    """The item price table only loads once a date range is chosen."""
    pg.locator(f"{scope} button", has_text="Select date range").first.click()
    pg.wait_for_timeout(400)
    days = pg.locator(".mantine-Popover-dropdown .mantine-DatePickerInput-day:not([data-outside]):not([disabled])")
    days.nth(1).click()
    days.nth(8).click()
    pg.wait_for_timeout(800)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)


def no_error_boundary(s: Suite, where: str) -> None:
    pg = s.page
    body = pg.evaluate("() => document.body.innerText")
    s.check("The station hit an error" not in body, f"{where}: the station safety net (StationSafe) was triggered")
    s.check("could not be shown here" not in body, f"{where}: a holo panel error boundary was triggered")
    s.check(pg.locator("[data-station-placeholder]").count() == 0, f"{where}: a panel shows the standalone placeholder instead of the real page")
    s.check("Unexpected Application Error" not in body, f"{where}: router error page")


def close_dialog(s: Suite) -> None:
    pg = s.page
    for _ in range(3):
        if pg.locator(".mantine-Modal-content").count() == 0:
            break
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
    if pg.locator(".mantine-Modal-content").count():
        pg.mouse.click(8, 400)
        pg.wait_for_timeout(500)
    s.check(pg.locator(".mantine-Modal-content").count() == 0, "the dialog cannot be closed")


def close_notifications(pg) -> None:
    pg.evaluate("() => document.querySelectorAll('.mantine-Notification-root button').forEach((b) => b.click())")


# --------------------------------------------------------------------------------------------
# station helpers
# --------------------------------------------------------------------------------------------


def enter_station(s: Suite) -> None:
    """The old 2D station is no start page any more: it is reached from the classic side bar."""
    wait_app(s)
    nav(s, "station")
    station_ready(s)


def station_ready(s: Suite) -> None:
    pg = s.page
    pg.wait_for_selector("canvas.vt-station-canvas", state="attached", timeout=30000)
    if has_game(pg):
        pg.wait_for_function("() => { const g = window.__vtStation; return !!(g && g.player && g.app); }", timeout=20000)
    pg.wait_for_function("() => window.__HARNESS__.counts['vt_plat_goal'] > 0 && window.__HARNESS__.counts['vt_sell_finder'] > 0 && window.__HARNESS__.counts['get_stock_item_pagination'] > 0", timeout=20000)
    pg.wait_for_timeout(900)


def room_of(pg) -> str:
    return pg.get_attribute(".vt-station-root", "data-station-room")


def map_go(s: Suite, place: str) -> None:
    pg = s.page
    pg.keyboard.press("m")
    pg.wait_for_selector("[data-station-map]", timeout=5000)
    pg.locator(f'[data-station-place="{place}"]').click()
    pg.wait_for_selector("[data-station-map]", state="detached", timeout=5000)
    pg.wait_for_timeout(450)


def target(pg):
    return G(pg, "g.current ? { kind: g.current.kind, id: g.current.id ?? (g.current.buyer ? g.current.buyer.id : (g.current.category ?? null)) } : null")


def approach(s: Suite, rect: dict, want_kind: str, want_id=None) -> bool:
    """Stand next to a world rectangle so that E targets it (works in both views)."""
    import math

    pg = s.page
    cx, cy = rect["x"] + rect["w"] / 2, rect["y"] + rect["h"] / 2
    for dist in (10, 14, 18, 6):
        for dx, dy in ((-1, 0), (1, 0), (0, 1), (0, -1)):
            x = cx + dx * (rect["w"] / 2 + dist)
            y = cy + dy * (rect["h"] / 2 + dist)
            angle = math.atan2(cy - (y - 2.5), cx - x)
            pg.evaluate("([x, y, a]) => window.__vtStation.travelTo(x, y, a)", [x, y, angle])
            pg.wait_for_timeout(160)
            t = target(pg)
            if t and t["kind"] == want_kind and (want_id is None or t["id"] == want_id):
                return True
    return False


def press_use(pg) -> None:
    pg.keyboard.press("e")
    pg.wait_for_timeout(500)


def card(pg, kind: str):
    return pg.locator(f'[data-station-card="{kind}"]')


def esc(pg, times: int = 1) -> None:
    for _ in range(times):
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(250)


def nothing_open(s: Suite, where: str) -> None:
    pg = s.page
    s.check(pg.locator(".vt-station-holo").count() == 0, f"{where}: a holo panel is still open")
    s.check(pg.locator(".vt-station-overlay").count() == 0, f"{where}: a card or overlay is still open")


def open_panel(s: Suite, panel_id: str, place: str) -> None:
    """Walk up to the terminal (map travel) and use it."""
    pg = s.page
    map_go(s, place)
    press_use(pg)
    pg.wait_for_selector(f'.vt-station-holo[data-station-panel="{panel_id}"]', timeout=6000)


def use_control(pg, scope: str, control) -> None:
    kind, name = control
    if kind == "tab":
        tab(pg, scope, name)
    elif kind == "button":
        pg.locator(scope).get_by_role("button", name=name, exact=False).first.click()
    elif kind == "text":
        pg.locator(scope).get_by_text(name, exact=False).first.click()
    elif kind == "css":
        pg.locator(name).first.click()
    pg.wait_for_timeout(700)


def check_panel(s: Suite, panel_id: str, proof: str, control, after: str | None, view: str) -> None:
    pg = s.page
    scope = f'.vt-station-holo[data-station-panel="{panel_id}"] .vt-station-holo-body'
    s.check(text_visible(pg, scope, proof), f"{panel_id}: the real page did not render (expected to see '{proof}')")
    no_error_boundary(s, panel_id)
    if has_game(pg):
        s.check(G(pg, "g.app.ticker.started") is False, f"{panel_id}: the station keeps rendering behind the panel")
    use_control(pg, scope, control)
    if after:
        where = "body" if panel_id == "about" else scope
        s.check(text_visible(pg, where, after), f"{panel_id}: using '{control[1]}' inside the panel did not work (expected '{after}')")
    no_error_boundary(s, panel_id + " after use")
    layout(s, scope, f"{panel_id} panel ({view})")


# --------------------------------------------------------------------------------------------
# scenarios
# --------------------------------------------------------------------------------------------


def scenario_boot(s: Suite) -> None:
    with s.step("boot: lands in the ship (the 3D game), with no app frame"):
        pg = s.open(1280, 800, storage=SHIP)
        wait_game(s)
        no_error_boundary(s, "boot")
        s.check(pg.evaluate("() => location.pathname") == "/", f"landed on {pg.url}")
        s.check(pg.locator("canvas.vtg-canvas").count() == 1, "no game canvas")
        s.check(pg.locator("nav button").count() == 0 and pg.locator("header").count() == 0 and pg.locator(".mantine-AppShell-root").count() == 0, "the classic app frame is mounted in the ship")
        s.check(V(pg, "g.where") == "vault", "did not start in the vault")
        s.check(H(pg, "h.counts['auth_me']") == 1, "auth_me was not called exactly once")
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") != "1", "the crash fallback switched to the classic view")
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_reason')") is None, "a fallback reason was recorded on a clean boot")

    with s.step("boot: an unhandled error is logged to the backend once, with valid arguments", allow=[r"harness-made rejection", r"Unhandled error"]):
        n0 = len(calls(pg, "log"))
        pg.evaluate("() => { Promise.reject(new Error('harness-made rejection')); }")
        pg.wait_for_timeout(900)
        logged = calls(pg, "log")[n0:]
        s.check(len(logged) == 1, f"expected exactly one log call, got {len(logged)} (a failing log call must not loop)")
        if logged:
            args = logged[0]["args"]
            s.check(args.get("message") == "harness-made rejection" and isinstance(args.get("context"), dict) and "stack" in args["context"], f"error details not sent as `context`: {args}")
            s.check("error" not in logged[0], f"the backend would reject the log call: {logged[0].get('error')}")

    with s.step("boot: a deep link still lands in the ship (every logged-in route is the game)"):
        pg = s.open(1280, 800, path="/live_scraper", storage=SHIP)
        wait_game(s)
        s.check(pg.locator("nav button").count() == 0 and pg.locator(".mantine-AppShell-root").count() == 0, "a classic route rendered in the ship")
        no_error_boundary(s, "deep link")

    with s.step("boot: with the classic fallback remembered, the app opens on classic Home"):
        pg = s.open(1280, 800, storage=CLASSIC)
        wait_app(s)
        pg.wait_for_timeout(800)
        s.check(pg.evaluate("() => location.pathname") == "/", f"landed on {pg.url}")
        s.check(text_visible(pg, ".mantine-AppShell-main", "Total Profit"), "Home did not render")
        s.check(pg.locator("canvas.vt-station-canvas").count() == 0, "station canvas on Home")
        s.check(pg.locator("[data-vtg-host]").count() == 0, "the game is mounted in the classic view")
        s.check(pg.locator("nav [data-vt-return-ship]").count() == 1, "no 'Return to the ship' control in the classic view")

    with s.step("boot: reloading on a classic route comes back up without errors"):
        # upstream behaviour: while auth_me is loading the gate sends every route to the start page
        pg = s.open(1280, 800, path="/live_scraper", storage=CLASSIC)
        wait_app(s)
        pg.wait_for_timeout(800)
        s.check(pg.evaluate("() => location.pathname") in ("/", "/live_scraper"), f"landed on {pg.url}")
        no_error_boundary(s, "reload on a route")

    with s.step("boot: backend still starting shows the splash, then app:ready opens the app"):
        pg = s.open(1280, 800, options={"started": False}, storage=SHIP)
        pg.wait_for_timeout(1500)
        s.check(pg.locator("[data-vtg-host]").count() == 0 and pg.locator("nav button").count() == 0, "the app was shown before the backend was ready")
        s.check(pg.locator("[class*=splashScreen]").count() >= 1, "no splash screen while the backend starts")
        delivered = H(pg, "h.ready()")
        s.check(delivered >= 1, "nobody listens to app:ready")
        wait_game(s)
        no_error_boundary(s, "late start")

    with s.step("boot: logged out shows the login page; logging in opens the app"):
        pg = s.open(1280, 800, options={"loggedIn": False}, storage=SHIP)
        pg.wait_for_function("() => location.pathname === '/auth/login'", timeout=20000)
        pg.wait_for_selector("input[type=password]", timeout=10000)
        s.check(pg.locator("[data-vtg-host]").count() == 0, "the game is mounted on the login page")
        pg.locator("input").first.fill("tester@example.invalid")
        pg.locator("input[type=password]").fill("correct horse")
        pg.locator("form button[type=submit], form button").last.click()
        pg.wait_for_function("() => location.pathname !== '/auth/login'", timeout=10000)
        wait_game(s)
        s.check(len(calls(pg, "auth_login")) == 1, "auth_login not called")
        s.check(pg.locator("nav button").count() == 0, "the classic side bar is shown after logging in")
        no_error_boundary(s, "after login")

    # the same two dialogs inside the ship (on the Comms display) are in the `shell` scenario
    with s.step("boot: new terms of service must be accepted (classic view)"):
        pg = s.open(1280, 800, options={"tosAccepted": False}, storage=CLASSIC)
        wait_app(s)
        pg.wait_for_selector(".mantine-Modal-content", timeout=8000)
        s.check(text_visible(pg, ".mantine-Modal-content", "Data Protection Policy"), "terms text (src-tauri/resources/tos.md) not shown")
        box = pg.locator(".mantine-Modal-content .mantine-ScrollArea-viewport").first
        if box.count():
            box.evaluate("(el) => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); }")
            pg.wait_for_timeout(400)
        pg.locator(".mantine-Modal-content button").last.click()
        pg.wait_for_timeout(600)
        s.check(len(calls(pg, "app_accept_tos")) == 1 or len(calls(pg, "app_exit")) == 1, "neither accept nor decline reached the backend")

    with s.step("boot: update available dialog (classic view)"):
        pg = s.open(1280, 800, options={"updateAvailable": True}, storage=CLASSIC)
        wait_app(s)
        pg.wait_for_selector(".mantine-Modal-content", timeout=8000)
        s.check(text_visible(pg, ".mantine-Modal-content", "1.13.0"), "new version not shown")


def scenario_classic(s: Suite, w: int = 1280, h: int = 800, tag: str = "") -> None:
    main = ".mantine-AppShell-main"
    with s.step(f"classic{tag}: home"):
        pg = s.open(w, h, storage={"vt_station_start": "0"})
        wait_app(s)
        pg.wait_for_timeout(1200)
        for t in ("Total Profit", "Today's Profit", "Best Seller", "Last Transaction", "VAULT"):
            s.check(text_visible(pg, main, t), f"home: '{t}' missing")
        s.check(pg.locator(f"{main} canvas").count() >= 3, "home: charts missing")
        layout(s, main, "home")

    with s.step(f"classic{tag}: live trading, Item tab"):
        nav(s, "live_scraper")
        s.check(text_visible(pg, main, "Glaive Prime Set"), "stock items missing")
        s.check(text_visible(pg, main, "net worth"), "strategy panel missing")
        layout(s, main, "live trading")

    with s.step(f"classic{tag}: live trading, strategy expanded"):
        pg.get_by_role("button", name="Show presets and activity").click()
        pg.wait_for_timeout(700)
        for t in ("Scavenger", "Flipper", "High Roller", "Riven Hunter", "Liquidate"):
            s.check(text_visible(pg, main, t), f"preset {t} missing")
        s.check(text_visible(pg, main, "Only 14 trades left today"), "smart trader activity feed missing")
        layout(s, main, "live trading with strategy expanded")
        # the tabs and the table must still be reachable below the expanded panel
        tabs_top = pg.get_by_role("tab", name="Riven").first.bounding_box()
        s.check(tabs_top is not None, "tabs not found with the strategy expanded")

    with s.step(f"classic{tag}: strategy, pick an allowed preset"):
        pg.locator(f"{main} button[aria-pressed]", has_text="Flipper").click()
        pg.wait_for_timeout(600)
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.preset") == "flipper", "preset not changed in the backend")
        s.check(pg.locator(f"{main} button[aria-pressed=true]", has_text="Flipper").count() == 1, "Flipper not shown as selected")
        s.check(text_visible(pg, main, "Trading as Flipper"), "badge not updated")

    with s.step(f"classic{tag}: strategy, a locked preset cannot be picked"):
        before = len(calls(pg, "vt_strategy_set"))
        locked = pg.locator(f"{main} button[aria-disabled=true]", has_text="High Roller")
        s.check(locked.count() == 1, "High Roller should be locked at this net worth")
        locked.click(force=True)
        pg.wait_for_timeout(400)
        s.check(len(calls(pg, "vt_strategy_set")) == before, "a locked preset reached the backend")
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.preset") == "flipper", "preset changed")

    with s.step(f"classic{tag}: strategy, strict tiers off unlocks, on again is refused while above tier", allow=[r"Tauri Invoke - vt_strategy_set|needs a net worth|%cError|Stack Trace"]):
        pg.get_by_role("switch", name="Strict tiers").click(force=True)
        pg.wait_for_timeout(500)
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.strict_tiers") is False, "strict tiers not switched off")
        pg.locator(f"{main} button[aria-pressed]", has_text="High Roller").click()
        pg.wait_for_timeout(500)
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.preset") == "high_roller", "High Roller not selected with strict tiers off")
        pg.get_by_role("switch", name="Strict tiers").click(force=True)
        pg.wait_for_timeout(700)
        s.check(text_visible(pg, "body", "Strategy not changed"), "the backend refusal was not shown")
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.strict_tiers") is False, "strict tiers changed although refused")
        close_notifications(pg)
        pg.locator(f"{main} button[aria-pressed]", has_text="Scavenger").click()
        pg.wait_for_timeout(400)
        pg.get_by_role("switch", name="Strict tiers").click(force=True)
        pg.wait_for_timeout(400)
        pg.get_by_role("switch", name="Smart trader").click(force=True)
        pg.wait_for_timeout(400)
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.smart_enabled") is False, "smart trader not switched off")
        pg.get_by_role("switch", name="Smart trader").click(force=True)
        pg.wait_for_timeout(400)

    with s.step(f"classic{tag}: live trader start (confirmation) and stop"):
        pg.get_by_role("button", name="Start Live Scraper").click()
        pg.wait_for_selector(".mantine-Modal-content", timeout=4000)
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Start").click()
        pg.wait_for_timeout(700)
        s.check(H(pg, "h.state.running") is True, "trader not started")
        s.check(text_visible(pg, main, "Stop Live Scraper"), "button did not flip")
        s.check(text_visible(pg, main, "Checking Item"), "status line missing")
        layout(s, main, "live trading while running")
        pg.get_by_role("button", name="Stop Live Scraper").click()
        pg.wait_for_timeout(600)
        s.check(H(pg, "h.state.running") is False, "trader not stopped")

    with s.step(f"classic{tag}: live trading, collapse strategy; item row actions"):
        pg.get_by_role("button", name="Hide presets and activity").click()
        pg.wait_for_timeout(500)
        row = pg.locator(f"{main} tbody tr", has_text="Nova Prime Set")
        owned_before = H(pg, "h.state.stockItems.find((i) => i.item_name === 'Nova Prime Set').owned")
        s.check(row.locator("button").count() >= 6, "row actions missing")
        # hammer = sold one at the list price
        row.locator("button:has(svg[data-icon='hammer'])").first.click()
        pg.wait_for_timeout(900)
        owned_after = H(pg, "(h.state.stockItems.find((i) => i.item_name === 'Nova Prime Set') || { owned: 0 }).owned")
        s.check(owned_after == owned_before - 1, f"auto sell did not reduce stock ({owned_before} -> {owned_after})")
        close_notifications(pg)

    with s.step(f"classic{tag}: live trading, item info dialog"):
        row = pg.locator(f"{main} tbody tr", has_text="Glaive Prime Set")
        row.locator("button:has(svg[data-icon='info'])").last.click()
        pg.wait_for_selector(".mantine-Modal-content", timeout=5000)
        pg.wait_for_timeout(800)
        s.check(len(calls(pg, "stock_item_get_by_id")) >= 1, "details not requested")
        tabs_in = pg.locator(".mantine-Modal-content [role=tab]")
        for i in range(tabs_in.count()):
            tabs_in.nth(i).click()
            pg.wait_for_timeout(350)
        pg.screenshot(path=str(s.shots / f"{s.label}-detail-item-info{tag.replace(' ', '-')}.png"))
        close_dialog(s)

    for name, proof in (("Riven", "Rubico"), ("Wishlist", "Primed Flow"), ("Syndicate", None)):
        with s.step(f"classic{tag}: live trading, {name} tab"):
            tab(pg, main, name)
            if proof:
                s.check(text_visible(pg, main, proof), f"{name}: '{proof}' missing")
            layout(s, main, f"live trading {name} tab")
        if proof:
            with s.step(f"classic{tag}: live trading, {name} info dialog (every tab)"):
                command = "stock_riven_get_by_id" if name == "Riven" else "wish_list_get_by_id"
                n0 = len(calls(pg, command))
                pg.locator(f"{main} tbody tr", has_text=proof).locator("button:has(svg[data-icon='info'])").last.click()
                pg.wait_for_selector(".mantine-Modal-content", timeout=5000)
                pg.wait_for_timeout(800)
                s.check(len(calls(pg, command)) == n0 + 1, "details not requested")
                tabs_in = pg.locator(".mantine-Modal-content [role=tab]")
                for i in range(tabs_in.count()):
                    tabs_in.nth(i).click()
                    pg.wait_for_timeout(350)
                pg.screenshot(path=str(s.shots / f"{s.label}-detail-{name.lower()}-info{tag.replace(' ', '-')}.png"))
                close_dialog(s)
    tab(pg, main, "Item")

    with s.step(f"classic{tag}: warframe market, orders"):
        nav(s, "warframe_market")
        s.check(text_visible(pg, main, "Sell Order"), "orders summary missing")
        s.check(text_visible(pg, main, "Kronen Prime Set"), "orders missing")
        layout(s, main, "warframe market orders")

    with s.step(f"classic{tag}: warframe market, auctions"):
        tab(pg, main, "Auctions")
        s.check(text_visible(pg, main, "Critacan"), "auctions missing")
        layout(s, main, "warframe market auctions")

    with s.step(f"classic{tag}: chat, open a chat and reply"):
        nav(s, "chat")
        s.check(text_visible(pg, main, "VoidRunner77"), "chat list missing")
        layout(s, main, "chat list")
        pg.locator(main).get_by_text("PlatBaron").first.click()
        pg.wait_for_timeout(900)
        s.check(text_visible(pg, main, "450 is the lowest I can go."), "messages missing")
        layout(s, main, "chat")
        editor = pg.locator(f"{main} [contenteditable=true], {main} textarea").first
        editor.click()
        pg.keyboard.type("thanks for the trade")
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(900)
        s.check(len(calls(pg, "chat_send_message")) == 1, "message not sent")
        s.check(text_visible(pg, main, "thanks for the trade"), "sent message not shown")

    with s.step(f"classic{tag}: trading analytics, transactions"):
        nav(s, "trading_analytics")
        s.check(text_visible(pg, main, "Created At"), "transactions table missing")
        layout(s, main, "trading analytics transactions")

    with s.step(f"classic{tag}: trading analytics, transactions chart view"):
        pg.locator(main).get_by_text("Chart", exact=True).first.click()
        pg.wait_for_timeout(1200)
        s.check(pg.locator(f"{main} canvas").count() >= 1, "chart missing")
        layout(s, main, "trading analytics chart view")
        pg.screenshot(path=str(s.shots / f"{s.label}-detail-transactions-chart{tag.replace(' ', '-')}.png"))
        pg.locator(main).get_by_text("List", exact=True).first.click()
        pg.wait_for_timeout(500)

    for name, proof in (("Item", "Glaive Prime Set"), ("Syndicate", None), ("Riven", "Rubico"), ("User Activity", None), ("Warframe GDPR Parser", None)):
        with s.step(f"classic{tag}: trading analytics, {name} tab"):
            tab(pg, main, name)
            pg.wait_for_timeout(600)
            if name == "Item":
                pick_date_range(pg, main)
            if proof:
                s.check(text_visible(pg, main, proof), f"{name}: '{proof}' missing")
            layout(s, main, f"trading analytics {name} tab")
            if name == "Riven":
                scan = pg.get_by_role("button", name="Scan", exact=False).first
                scan.click()
                pg.wait_for_timeout(700)
                s.check(len(calls(pg, "vt_riven_market_scan")) == 1, "scan not started")
                s.check(H(pg, "h.state.rivenScan.running") is True or H(pg, "h.state.rivenScan.done") > 0, "scan state not running")
                pg.screenshot(path=str(s.shots / f"{s.label}-detail-riven-scan-running{tag.replace(' ', '-')}.png"))
                pg.wait_for_function("() => window.__HARNESS__.state.rivenScan.running === false", timeout=15000)
                pg.wait_for_timeout(2600)

    with s.step(f"classic{tag}: cargo, sell finder"):
        nav(s, "wf_inventory")
        s.check(text_visible(pg, main, "trades left today"), "sell finder not connected")
        s.check(pg.get_by_role("button", name="Add to stock").count() >= 30, "about 40 rows expected")
        layout(s, main, "cargo sell finder")
        scroller = pg.locator(f"{main} .mantine-ScrollArea-viewport").first
        s.check(scroller.evaluate("(el) => el.scrollHeight > el.clientHeight + 20"), "the sell finder table does not scroll")
        scroller.evaluate("(el) => { el.scrollTop = el.scrollHeight; }")
        pg.wait_for_timeout(300)
        last = pg.get_by_role("button", name="Add to stock").last.bounding_box()
        s.check(last is not None and last["y"] + last["height"] <= h + 1, "the last sell finder row cannot be scrolled into view")
        scroller.evaluate("(el) => { el.scrollTop = 0; }")

    with s.step(f"classic{tag}: cargo, add to stock and filters"):
        before = H(pg, "h.state.stockItems.length")
        row = pg.locator(f"{main} tbody tr", has_text="Mesa Prime Set")
        row.get_by_role("button", name="Add to stock").click()
        pg.wait_for_timeout(900)
        s.check(H(pg, "h.state.stockItems.length") == before + 1, "item not added to stock")
        s.check(H(pg, "h.state.stockItems.some((i) => i.item_name === 'Mesa Prime Set' && i.bought === 0)"), "added item wrong")
        pg.locator(main).get_by_text("Arcanes", exact=True).click()
        pg.wait_for_timeout(400)
        s.check(text_visible(pg, main, "Arcane Grace"), "category filter broke")
        s.check(pg.locator(f"{main} tbody tr", has_text="Glaive Prime Set").count() == 0, "category filter did not filter")
        pg.get_by_role("button", name="Refresh inventory").click()
        pg.wait_for_timeout(700)
        s.check(len(calls(pg, "wf_inventory_update")) >= 1, "refresh did not rescan")
        close_notifications(pg)

    with s.step(f"classic{tag}: cargo, rivens tab"):
        tab(pg, main, "Rivens")
        s.check(text_visible(pg, main, "Catchmoon"), "inventory rivens missing")
        layout(s, main, "cargo rivens")

    for name, proof in (("Item", "Glaive Prime Set"), ("Custom", "Carry service"), ("Riven", "Rubico")):
        with s.step(f"classic{tag}: trade messages, {name} tab"):
            if name == "Item":
                nav(s, "trade_messages")
            else:
                tab(pg, main, name)
            s.check(text_visible(pg, main, proof), f"'{proof}' missing")
            layout(s, main, f"trade messages {name}")

    with s.step(f"classic{tag}: about, check for updates"):
        nav(s, "about")
        s.check(text_visible(pg, main, "Version"), "about missing")
        layout(s, main, "about")
        pg.get_by_role("button", name="Check for Updates").click()
        pg.wait_for_timeout(700)
        s.check(text_visible(pg, "body", "No updates available"), "no-update notice missing")
        close_notifications(pg)

    if pg.locator("nav button").count() == len(NAV):
        for name, proof in (("Logging", "Add Log"), ("States", "WFM State"), ("Debugging", None), ("EE Log", "mock EE.log line")):
            with s.step(f"classic{tag}: debug, {name} tab"):
                if name == "Logging":
                    nav(s, "debug")
                else:
                    tab(pg, main, name)
                    pg.wait_for_timeout(500)
                if proof:
                    s.check(text_visible(pg, main, proof), f"'{proof}' missing")
                layout(s, main, f"debug {name}")

    with s.step(f"classic{tag}: user menu, status change"):
        pg.locator("header .mantine-Avatar-root").first.click()
        pg.wait_for_selector(".mantine-Menu-dropdown", timeout=4000)
        pg.locator(".mantine-Menu-dropdown [data-user-status='online']").click()
        pg.wait_for_timeout(500)
        s.check(H(pg, "h.state.user.wfm_status") == "online", "status not changed")

    with s.step(f"classic{tag}: settings modal opens"):
        if pg.locator(".mantine-Menu-dropdown").count() == 0:
            pg.locator("header .mantine-Avatar-root").first.click()
            pg.wait_for_selector(".mantine-Menu-dropdown", timeout=4000)
        pg.locator(".mantine-Menu-dropdown").get_by_text("Settings", exact=False).first.click()
        pg.wait_for_selector(".mantine-Modal-content", timeout=5000)
        pg.wait_for_timeout(700)
        s.check(text_visible(pg, ".mantine-Modal-content", "Live Scraper"), "settings form missing")

    settings_tabs(s, ".mantine-Modal-content", f"classic{tag}: settings")

    with s.step(f"classic{tag}: settings save"):
        before = len(calls(pg, "app_update_settings"))
        change_a_setting(pg, ".mantine-Modal-content")
        layout(s, ".mantine-Modal-content", "settings with the Save button")
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Save", exact=False).last.click()
        pg.wait_for_timeout(900)
        s.check(len(calls(pg, "app_update_settings")) == before + 1, "settings not saved")
        sent = calls(pg, "app_update_settings")[-1]["args"]["settings"]
        default = H(pg, "h.options && window.__HARNESS__.state.settings")
        s.check(sent["live_scraper"]["general"]["report_to_wfm"] is False, "the changed checkbox was not sent")
        missing = missing_keys(default, sent)
        s.check(not missing, f"the settings form dropped fields the backend requires: {missing}")
        s.check(H(pg, "h.state.settings.live_scraper.general.report_to_wfm") is False, "backend state not updated")
        close_notifications(pg)
        if pg.locator(".mantine-Modal-content").count():
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(400)

    with s.step(f"classic{tag}: backend events refresh the open page"):
        nav(s, "live_scraper")
        n0 = len(calls(pg, "get_stock_item_pagination"))
        H(pg, "h.emitUpdate('LiveScraper:RefreshStockItems', 'CREATE_OR_UPDATE', h.state.stockItems[0])")
        pg.wait_for_timeout(700)
        H(pg, "h.emitMessage('App:OnNotify', { i18n_key: 'on_new_trade', color: 'green.7', type: 'success', settings: {}, values: { player_name: 'StarHollow' } })")
        H(pg, "h.emitMessage('LiveScraper:OnMessage', { i18nKey: 'riven.rate_limited', values: { seconds: 3 } })")
        pg.wait_for_timeout(800)
        s.check(len(calls(pg, "get_stock_item_pagination")) >= n0, "page broke on refresh event")
        H(pg, "h.emitMessage('LiveScraper:OnMessage', null)")
        close_notifications(pg)


def missing_keys(have, sent, path: str = "") -> list[str]:
    """Keys of the backend's settings that the form did not send back (serde would reject the call)."""
    out: list[str] = []
    if isinstance(have, dict) and isinstance(sent, dict):
        for k, v in have.items():
            if k not in sent:
                if v is not None:
                    out.append(f"{path}{k}")
            else:
                out += missing_keys(v, sent[k], f"{path}{k}.")
    elif isinstance(have, dict) and not isinstance(sent, dict):
        out.append(f"{path[:-1]} (not an object any more)")
    return out


def change_a_setting(pg, scope: str) -> None:
    """The Save button only appears once the form is dirty: flip one checkbox."""
    pg.locator(f"{scope} [role=tab]", has_text="Live Scraper").first.click()
    pg.wait_for_timeout(400)
    pg.locator(f"{scope} [role=tablist]:visible").nth(1).locator("[role=tab]").first.click()
    pg.wait_for_timeout(300)
    pg.locator(scope).get_by_text("Report to Warframe Market", exact=False).first.click()
    pg.wait_for_timeout(400)


def settings_tabs(s: Suite, scope: str, label: str) -> None:
    """Every tab of the settings form, and the tabs inside each tab (up to three levels)."""
    pg = s.page

    def names(level: int) -> list[str]:
        lists = pg.locator(f"{scope} [role=tablist]:visible")
        if lists.count() <= level:
            return []
        return [t.strip() for t in lists.nth(level).locator("[role=tab]").all_inner_texts()]

    def walk(level: int, trail: list[str]) -> None:
        for i, name in enumerate(names(level)):
            path = trail + [name]
            with s.step(f"{label}, tab {' > '.join(path)}"):
                pg.locator(f"{scope} [role=tablist]:visible").nth(level).locator("[role=tab]").nth(i).click()
                pg.wait_for_timeout(450)
                s.check(pg.locator(f"{scope} [role=tabpanel]:visible").count() >= 1, "no tab panel")
                layout(s, scope, f"settings tab {' > '.join(path)}")
            if level < 2:
                walk(level + 1, path)
                # make sure the parent is still the active one for its next sibling
                pg.locator(f"{scope} [role=tablist]:visible").nth(level).locator("[role=tab]").nth(i).click()
                pg.wait_for_timeout(200)

    walk(0, [])


def scenario_classic_offline(s: Suite) -> None:
    """No inventory source: typed-in plat on the strategy panel, and the AlecaFrame connect flow."""
    main = ".mantine-AppShell-main"
    with s.step("no inventory: strategy asks for the plat balance"):
        pg = s.open(1280, 800, options={"inventory": "none"}, storage={"vt_station_start": "0"})
        wait_app(s)
        nav(s, "live_scraper")
        s.check(text_visible(pg, main, "Your plat right now"), "typed-in plat field missing")
        s.check(text_visible(pg, main, "(not set)"), "'not set' hint missing")
        layout(s, main, "live trading without inventory")

    with s.step("no inventory: typed-in plat is saved and changes the tier"):
        field = pg.get_by_label("Your plat right now")
        field.fill("76.9")
        pg.get_by_role("button", name="Set", exact=True).click()
        pg.wait_for_timeout(700)
        sets = calls(pg, "vt_strategy_set")
        s.check(len(sets) == 1 and isinstance(sets[0]["args"].get("manualPlatinum"), int), f"manual platinum must reach the backend as a whole number: {sets[-1]['args'] if sets else None}")
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.manual_platinum") in (76, 77), "manual platinum not stored")
        s.check(text_visible(pg, main, "(typed in)"), "'typed in' hint missing")
        field.fill("400")
        pg.get_by_role("button", name="Set", exact=True).click()
        pg.wait_for_timeout(700)
        s.check(text_visible(pg, main, "400p plat"), "balance not shown")

    with s.step("no inventory: home plat goal uses the typed-in balance"):
        nav(s, "home")
        s.check(text_visible(pg, main, "400p"), "typed-in balance not on the plat goal bar")
        layout(s, main, "home without inventory")

    with s.step("no inventory: cargo offers Connect AlecaFrame"):
        nav(s, "wf_inventory")
        s.check(pg.get_by_role("button", name="Connect AlecaFrame").count() == 1, "connect button missing")
        s.check(pg.get_by_role("button", name="Refresh inventory").is_disabled(), "refresh should be disabled without a source")
        layout(s, main, "cargo not connected")

    with s.step("no inventory: connect flow"):
        pg.get_by_role("button", name="Connect AlecaFrame").click()
        pg.wait_for_timeout(1200)
        s.check(H(pg, "JSON.stringify(h.state.settings.wf_inventory.source)") == '{"Alecaframe":{"path":""}}', "source not saved")
        s.check(text_visible(pg, main, "trades left today"), "sell finder did not load after connecting")
        s.check(pg.get_by_role("button", name="Connect AlecaFrame").count() == 0, "connect button still shown after connecting")
        s.check(pg.get_by_role("button", name="Refresh inventory").is_enabled(), "refresh stays disabled after connecting (stale settings)")
        layout(s, main, "cargo after connecting")

    with s.step("no inventory: settings saved later keep the connected source"):
        pg.locator("header .mantine-Avatar-root").first.click()
        pg.wait_for_selector(".mantine-Menu-dropdown", timeout=4000)
        pg.locator(".mantine-Menu-dropdown").get_by_text("Settings", exact=False).first.click()
        pg.wait_for_selector(".mantine-Modal-content", timeout=5000)
        pg.wait_for_timeout(600)
        change_a_setting(pg, ".mantine-Modal-content")
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Save", exact=False).last.click()
        pg.wait_for_timeout(800)
        s.check(H(pg, "JSON.stringify(h.state.settings.wf_inventory.source)") == '{"Alecaframe":{"path":""}}', "saving the settings form disconnected the inventory (stale settings were sent back)")
        close_notifications(pg)
        if pg.locator(".mantine-Modal-content").count():
            pg.keyboard.press("Escape")

    with s.step("no inventory: station shows the not-connected state"):
        pg = s.open(1280, 800, options={"inventory": "none"})
        enter_station(s)
        map_go(s, "Docks board")
        press_use(pg)
        s.check(card(pg, "docks").count() == 1, "docks card missing")
        s.check(text_visible(pg, "[data-station-card=docks]", "AlecaFrame") or text_visible(pg, "[data-station-card=docks]", "connect"), "docks card does not explain the missing inventory")
        esc(pg)
        map_go(s, "Inventory bays")
        pg.keyboard.press("Tab")
        pg.wait_for_timeout(500)
        s.check(pg.locator(".vt-station-panel").count() == 1, "stock list missing")
        esc(pg)
        no_error_boundary(s, "station without inventory")

    with s.step("no inventory: AlecaFrame file missing is reported, not hidden", allow=[r"wf_inventory_update|AlecaFrame data file not found|%cError|Stack Trace|vt_sell_finder failed"]):
        pg = s.open(1280, 800, options={"inventory": "missing"}, storage={"vt_station_start": "0"})
        wait_app(s)
        nav(s, "wf_inventory")
        pg.get_by_role("button", name="Refresh inventory").click()
        pg.wait_for_timeout(900)
        s.check(text_visible(pg, main, "AlecaFrame data file not found"), "backend error not shown")


def scenario_station(s: Suite, fp: bool = False) -> None:
    view = "fp" if fp else "top"
    tag = "first person" if fp else "top-down"
    with s.step(f"station {tag}: opens"):
        pg = s.open(1280, 800, storage={"vt_station_view": view} if fp else None)
        enter_station(s)
        no_error_boundary(s, "station")
        s.check(H(pg, "Object.keys(h.unknown).length") == 0, "unknown commands at start")
        if has_game(pg):
            s.check(G(pg, "g.view") == view, f"view is {G(pg, 'g.view')}")
        if fp:
            s.check(pg.locator(".vt-station-canvas-fp").is_visible(), "first-person canvas not visible")
        if not fp:  # in first person the readout is drawn into the 3D view
            s.check(text_visible(pg, ".vt-station-root", "312p"), "vault readout does not show the real balance")
        elif has_game(pg):
            s.check(G(pg, "g.goal && g.goal.platinum") == 312, "the vault does not hold the real balance")
        s.check(pg.locator(".vt-station-footer").get_by_text("Demo data").count() == 0, "station shows demo data inside the app")
        layout(s, ".vt-station-footer", "station footer")

    if not fp:
        with s.step("station: V switches to first person and back"):
            pg.keyboard.press("v")
            pg.wait_for_timeout(700)
            s.check(pg.locator(".vt-station-canvas-fp").is_visible(), "first-person canvas not visible after V")
            s.check(pg.evaluate("() => localStorage.getItem('vt_station_view')") == "fp", "view not remembered")
            pg.screenshot(path=str(s.shots / f"{s.label}-detail-first-person-vault.png"))
            pg.keyboard.press("v")
            pg.wait_for_timeout(600)
            s.check(not pg.locator(".vt-station-canvas-fp").is_visible(), "still first person after second V")

    for room, title in (("vault", "Vault"), ("warehouse", "Warehouse"), ("bridge", "Control Deck"), ("shop", "Shop Floor")):
        with s.step(f"station {tag}: room {title}"):
            pg.keyboard.press("m")
            pg.wait_for_selector("[data-station-map]", timeout=5000)
            pg.locator(f'[data-station-map-room="{room}"]').click()
            pg.wait_for_timeout(900)
            s.check(room_of(pg) == room, f"room is {room_of(pg)}")
            s.check(pg.locator("[data-station-room-badge]").inner_text().strip().lower() == title.lower(), "room badge wrong")
            if has_game(pg):
                s.check(G(pg, "g.app.ticker.started") is True, "renderer not running")
                s.check(G(pg, "g.position.room") == room, "game is in another room")

    # --- map: every entry
    pg.keyboard.press("m")
    pg.wait_for_selector("[data-station-map]", timeout=5000)
    places = pg.evaluate("() => [...document.querySelectorAll('[data-station-place]')].map((b) => [b.getAttribute('data-station-place'), b.closest('[data-station-map-room], .vt-station-map-room, div')?.querySelector('[data-station-map-room]')?.getAttribute('data-station-map-room') || null])")
    with s.step(f"station {tag}: map overlay"):
        s.check(len(places) >= 20, f"only {len(places)} map entries")
        layout(s, "[data-station-map]", "map overlay")
    esc(pg)
    with s.step(f"station {tag}: map teleport to every entry ({len(places)})", shot=False):
        bad = []
        for label, room in places:
            map_go(s, label)
            here = room_of(pg)
            if room and here != room:
                bad.append(f"{label}: ended in {here}, expected {room}")
            if fp or label in ("Plat tank", "Trade desk", "Inventory bays", "Stock shelves", "Riven case", "Wanted wall", "Trader lever", "Manager"):
                pg.screenshot(path=str(s.shots / f"{s.label}-place-{view}-{label.lower().replace(' ', '-').replace(chr(39), '')}.png"))
        s.check(not bad, "; ".join(bad))
        nothing_open(s, "after map travel")

    # --- every terminal opens the real page
    for panel_id, place, proof, control, after in PANELS:
        with s.step(f"station {tag}: {place} opens the real {panel_id} page", allow=[r"plugin:process"] if panel_id == "about" else None):
            open_panel(s, panel_id, place)
            check_panel(s, panel_id, proof, control, after, view)
            if panel_id == "captain":
                s.check(H(pg, "h.state.user.wfm_status") == "online", "status not changed from the captain's console")
            close_notifications(pg)
        with s.step(f"station {tag}: {panel_id} closes with Esc", shot=False):
            pg.locator(".vt-station-holo-bar").click(position={"x": 5, "y": 5})
            esc(pg)
            if pg.locator(".vt-station-holo").count():
                esc(pg)
            nothing_open(s, panel_id)
            if has_game(pg):
                s.check(G(pg, "g.app.ticker.started") is True, "the station did not resume after the panel closed")

    with s.step(f"station {tag}: engineering terminal saves settings and closes"):
        open_panel(s, "engineering", "Engineering terminal")
        before = len(calls(pg, "app_update_settings"))
        scope = ".vt-station-holo-body"
        change_a_setting(pg, scope)
        layout(s, scope, "engineering panel with the Save button")
        pg.locator(scope).get_by_role("button", name="Save", exact=False).last.click()
        pg.wait_for_timeout(900)
        s.check(len(calls(pg, "app_update_settings")) == before + 1, "settings not saved")
        s.check(pg.locator(".vt-station-holo").count() == 0, "panel did not close after saving")
        close_notifications(pg)

    with s.step(f"station {tag}: panel 'Open in classic view' and back"):
        open_panel(s, "ledger", "Ledger terminal")
        pg.locator("[data-station-panel-classic]").click()
        pg.wait_for_function("() => location.pathname === '/trading_analytics'", timeout=6000)
        pg.wait_for_selector(".vt-station-root", state="detached", timeout=10000)
        s.check(text_visible(pg, ".mantine-AppShell-main", "Warframe GDPR Parser"), "classic page missing")
        nav(s, "station")
        station_ready(s)
        no_error_boundary(s, "back in the station")

    # --- trader lever
    with s.step(f"station {tag}: trader lever asks before starting, then starts"):
        map_go(s, "Trader lever")
        press_use(pg)
        pg.wait_for_selector(".mantine-Modal-content", timeout=4000)
        s.check(H(pg, "h.state.running") is False, "started before confirming")
        pg.screenshot(path=str(s.shots / f"{s.label}-detail-lever-confirm-{view}.png"))
        # station keys must be dead while the dialog is open
        pg.keyboard.press("m")
        pg.wait_for_timeout(200)
        s.check(pg.locator("[data-station-map]").count() == 0, "map opened behind the confirmation dialog")
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Start").click()
        pg.wait_for_timeout(900)
        s.check(H(pg, "h.state.running") is True, "trader not started")
        s.check("running" in pg.locator("[data-station-trader-badge]").inner_text().lower(), "badge not updated")
        if has_game(pg):
            s.check(G(pg, "g.trader.running") is True, "game not told")
            pg.wait_for_function("() => window.__vtStation.trader.message.includes('Checking Item')", timeout=4000)
    with s.step(f"station {tag}: trader lever, cancel keeps it as it is; stop needs no question"):
        press_use(pg)
        pg.wait_for_timeout(600)
        s.check(H(pg, "h.state.running") is False, "trader not stopped")
        s.check(pg.locator(".mantine-Modal-content").count() == 0, "stop asked for confirmation")
        press_use(pg)
        pg.wait_for_selector(".mantine-Modal-content", timeout=4000)
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Cancel").click()
        pg.wait_for_timeout(500)
        s.check(H(pg, "h.state.running") is False, "cancel started the trader")

    with s.step(f"station {tag}: a refused trader switch is reported", allow=[r"live_scraper_toggle|Mock refusal|%cError|Stack Trace"]):
        H(pg, "h.fail('live_scraper_toggle', { component: 'LiveScraper', message: 'Mock refusal: not logged in', cause: '', log_level: 'error' })")
        press_use(pg)
        pg.wait_for_selector(".mantine-Modal-content", timeout=4000)
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Start").click()
        pg.wait_for_timeout(800)
        s.check(H(pg, "h.state.running") is False, "trader started although refused")
        s.check(text_visible(pg, "body", "Mock refusal: not logged in"), "the refusal was not shown to the user")
        s.check(len(calls(pg, "log")) == 0, "the refusal ended up as an unhandled error instead of a message")
        close_notifications(pg)

    with s.step(f"station {tag}: manager card (real strategy panel)"):
        map_go(s, "Manager")
        press_use(pg)
        s.check(card(pg, "manager").count() == 1, "manager card missing")
        s.check(text_visible(pg, "[data-station-card=manager]", "net worth"), "real strategy panel missing")
        s.check(pg.locator("[data-station-demo-strategy]").count() == 0, "demo strategy shown inside the app")
        layout(s, "[data-station-card=manager]", "manager card")
        toggle = pg.locator("[data-station-card=manager]").get_by_role("button", name="presets and activity")
        if "Show" in toggle.inner_text():
            toggle.click()
            pg.wait_for_timeout(600)
        pg.locator("[data-station-card=manager] button[aria-pressed]", has_text="Flipper").click()
        pg.wait_for_timeout(600)
        s.check(H(pg, "h.state.settings.live_scraper.void_trader.preset") == "flipper", "preset not changed from the manager card")
        layout(s, "[data-station-card=manager]", "manager card expanded")
    with s.step(f"station {tag}: manager card starts and stops the trader"):
        pg.locator("[data-station-manager-toggle]").click()
        pg.wait_for_selector(".mantine-Modal-content", timeout=4000)
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Start").click()
        pg.wait_for_timeout(700)
        s.check(H(pg, "h.state.running") is True, "not started")
        pg.locator("[data-station-manager-toggle]").click()
        pg.wait_for_timeout(600)
        s.check(H(pg, "h.state.running") is False, "not stopped")
        pg.locator("[data-station-card=manager] button[aria-pressed]", has_text="Scavenger").click()
        pg.wait_for_timeout(400)
        esc(pg)
        nothing_open(s, "manager")

    with s.step(f"station {tag}: docks card"):
        map_go(s, "Docks board")
        press_use(pg)
        s.check(card(pg, "docks").count() == 1, "docks card missing")
        s.check(text_visible(pg, "[data-station-card=docks]", "14"), "trades left not shown")
        layout(s, "[data-station-card=docks]", "docks card")
        esc(pg)

    with s.step(f"station {tag}: plat tank card"):
        map_go(s, "Plat tank")
        press_use(pg)
        s.check(card(pg, "tank").count() == 1, "tank card missing")
        s.check(text_visible(pg, "[data-station-card=tank]", "312"), "balance missing")
        layout(s, "[data-station-card=tank]", "tank card")
        esc(pg)

    with s.step(f"station {tag}: empty trade desk card"):
        map_go(s, "Trade desk")
        press_use(pg)
        s.check(card(pg, "counter").count() == 1, "counter card missing")
        esc(pg)

    # --- shop floor cards
    station_stock(s, view)
    station_warehouse(s, view)
    station_overlays(s, view)
    station_buyers(s, view)

    with s.step(f"station {tag}: Classic view button, then back with the Station button"):
        pg.locator("[data-station-classic]").click()
        pg.wait_for_function("() => location.pathname === '/'", timeout=6000)
        pg.wait_for_selector(".vt-station-root", state="detached", timeout=10000)
        pg.wait_for_timeout(700)
        s.check(text_visible(pg, ".mantine-AppShell-main", "Total Profit"), "Home not shown (redirected back?)")
        s.check(pg.locator("canvas").filter(has=pg.locator("xpath=self::*[contains(@class,'vt-station-canvas')]")).count() == 0, "station canvas left behind on Home")
        s.check(pg.locator("nav button").nth(NAV.index("home")).get_attribute("data-active") == "true", "side bar does not mark Home after leaving the station")
        nav(s, "station")
        station_ready(s)
        no_error_boundary(s, "returned")
        s.check(pg.locator("nav button").nth(NAV.index("station")).get_attribute("data-active") == "true", "side bar does not mark Station")

    with s.step(f"station {tag}: log out from the captain's console"):
        open_panel(s, "captain", "Captain's console")
        pg.locator("[data-station-captain]").get_by_role("button", name="Log", exact=False).click()
        pg.wait_for_selector(".mantine-Modal-content", timeout=4000)
        s.check(H(pg, "h.state.user.anonymous") is False, "logged out before confirming")
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Yes").click()
        pg.wait_for_function("() => location.pathname === '/auth/login'", timeout=8000)
        s.check(len(calls(pg, "auth_logout")) == 1, "auth_logout not called")
        s.check(pg.locator(".vt-station-root").count() == 0, "the station is still shown after logging out")
        pg.wait_for_selector("input[type=password]", timeout=8000)


def open_stock_card(s: Suite, kind: str, row_expr: str, label_expr: str, view: str) -> dict:
    """Open the card of a shelf object: by walking up to it and pressing E when the game handle
    exists (dev server), otherwise through the do-anything palette."""
    pg = s.page
    row = H(pg, row_expr)
    if has_game(pg):
        rect = G(pg, "(g.shopData.crates.find((c) => c.kind === '%s' && c.id === %d) || {}).rect || null" % (kind, row["id"])) if kind != "wish" else None
        if kind == "wish":
            board = G(pg, "(() => { const b = g.shopData.boards.find((x) => x.id === %d); return b ? g.boardStrip(b) : null; })()" % row["id"])
            rect = board
        s.check(rect is not None, f"{kind} {row['id']} is not on the shelves")
        if rect:
            ok = approach(s, rect, kind, row["id"])
            s.check(ok, f"could not get the {kind} into reach (E target is {target(pg)})")
            pg.screenshot(path=str(s.shots / f"{s.label}-detail-{kind}-prompt-{view}.png"))
            press_use(pg)
    else:
        pg.keyboard.press("k")
        pg.wait_for_selector("[data-station-palette-input]", timeout=4000)
        pg.keyboard.type(H(pg, label_expr))
        pg.wait_for_timeout(300)
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(500)
    pg.wait_for_selector(f'[data-station-card="{kind}"]', timeout=5000)
    return row


def station_stock(s: Suite, view: str) -> None:
    pg = s.page
    tag = "first person" if view == "fp" else "top-down"
    c = "[data-station-card=stock]"
    map_go(s, "Stock shelves")

    with s.step(f"station {tag}: stock crate card, sell two at a price each"):
        row = open_stock_card(s, "stock", "h.state.stockItems.find((i) => i.item_name === 'Blind Rage')", "'Blind Rage'", view)
        s.check(text_visible(pg, c, "Blind Rage"), "wrong card")
        layout(s, c, "stock card")
        pg.locator(f"{c} [data-station-qty] input, {c} input[data-station-qty]").first.fill("2")
        pg.locator(f"{c} [data-station-price] input, {c} input[data-station-price]").first.fill("15")
        tx0 = H(pg, "h.state.transactions.length")
        pg.locator(f"{c} [data-station-sell]").click()
        pg.wait_for_selector(f"{c} [data-station-done-note]", timeout=5000)
        sell = calls(pg, "stock_item_sell")[-1]["args"]
        s.check(sell["quantity"] == 2 and sell["price"] == 30, f"selling 2 at 15p each must reach the backend as quantity 2, price 30 (the total): got {sell}")
        s.check(H(pg, "h.state.stockItems.find((i) => i.id === %d).owned" % row["id"]) == row["owned"] - 2, "stock not reduced by 2")
        s.check(H(pg, "h.state.transactions.length") == tx0 + 1, "no transaction recorded")
        s.check(H(pg, "h.state.transactions[0].price") == 30, "transaction total wrong")
        pg.wait_for_timeout(1200)
        s.check(text_visible(pg, c, str(row["owned"] - 2)), "card does not show the new stock count")

    with s.step(f"station {tag}: stock crate card shows the backend's reason when a sale is refused", allow=[r"stock_item_sell|Mock refusal|%cError|Stack Trace"]):
        H(pg, "h.fail('stock_item_sell', { component: 'StockItem:Sold', message: 'Mock refusal: the item is locked by the live trader', cause: '', log_level: 'error' })")
        before = H(pg, "h.state.stockItems.find((i) => i.id === %d).owned" % row["id"])
        pg.locator(f"{c} [data-station-sell]").click()
        pg.wait_for_selector(f"{c} [data-station-error]", timeout=5000)
        s.check(text_visible(pg, f"{c} [data-station-error]", "locked by the live trader"), "the backend's reason is not shown")
        s.check(H(pg, "h.state.stockItems.find((i) => i.id === %d).owned" % row["id"]) == before, "stock changed although the sale was refused")
        layout(s, c, "stock card with an error")

    with s.step(f"station {tag}: stock crate card, sold one at the list price"):
        pg.locator(f"{c} [data-station-sell-auto]").click()
        pg.wait_for_timeout(1300)
        sell = calls(pg, "stock_item_sell")[-1]["args"]
        s.check(sell["quantity"] == 1 and sell["price"] == row["list_price"], f"auto sell payload wrong: {sell}")
        s.check(H(pg, "h.state.stockItems.find((i) => i.id === %d).owned" % row["id"]) == row["owned"] - 3, "stock not reduced")
        s.check(pg.locator(f"{c} [data-station-error]").count() == 0, "the old error is still shown after a successful sale")

    with s.step(f"station {tag}: stock crate card, edit and save"):
        pg.locator(f"{c} [data-station-mode] label", has_text="Edit").click()
        pg.wait_for_timeout(300)
        pg.locator(c).get_by_label("Paid each").fill("7")
        pg.locator(c).get_by_label("Minimum price").fill("11")
        pg.locator(f"{c} [data-station-save]").click()
        pg.wait_for_timeout(1200)
        now = H(pg, "h.state.stockItems.find((i) => i.id === %d)" % row["id"])
        s.check(now["bought"] == 7 and now.get("properties", {}).get("min_price") == 11, f"edit not saved: {now}")
        s.check(now.get("properties", {}).get("min_profit") == 3 and now.get("properties", {}).get("min_sma") == 2, "saving from the station wiped the other per-item settings")
        layout(s, c, "stock card edit mode")

    with s.step(f"station {tag}: stock crate card, hide and show"):
        pg.locator(f"{c} [data-station-hide]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "h.state.stockItems.find((i) => i.id === %d).is_hidden" % row["id"]) is True, "not hidden")
        pg.locator(f"{c} [data-station-hide]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "h.state.stockItems.find((i) => i.id === %d).is_hidden" % row["id"]) is False, "not shown again")

    with s.step(f"station {tag}: stock crate card, delete (two clicks)"):
        pg.locator(f"{c} [data-station-delete]").click()
        pg.wait_for_timeout(300)
        s.check(H(pg, "h.state.stockItems.some((i) => i.id === %d)" % row["id"]), "deleted on the first click")
        pg.locator(f"{c} [data-station-delete]").click()
        pg.wait_for_timeout(1300)
        s.check(not H(pg, "h.state.stockItems.some((i) => i.id === %d)" % row["id"]), "not deleted")
        s.check(card(pg, "gone").count() == 1 or card(pg, "stock").count() == 0, "card still shows the deleted item")
        esc(pg)
        if has_game(pg):
            s.check(G(pg, "g.shopData.crates.some((c) => c.kind === 'stock' && c.id === %d)" % row["id"]) is False, "crate still on the shelf")
        nothing_open(s, "stock card")

    with s.step(f"station {tag}: stock card 'more' opens the Live Trading page"):
        open_stock_card(s, "stock", "h.state.stockItems.find((i) => i.item_name === 'Glaive Prime Set')", "'Glaive Prime Set'", view)
        pg.locator(f"{c} [data-station-more]").click()
        pg.wait_for_selector('.vt-station-holo[data-station-panel="live"]', timeout=5000)
        s.check(text_visible(pg, ".vt-station-holo-body", "Start Live Scraper"), "live trading page missing")
        esc(pg)
        esc(pg)
        nothing_open(s, "after more")

    c = "[data-station-card=riven]"
    with s.step(f"station {tag}: riven case card, edit and sell"):
        map_go(s, "Riven case")
        row = open_stock_card(s, "riven", "h.state.stockRivens.find((r) => r.weapon_name === 'Kronen')", "'Kronen'", view)
        s.check(text_visible(pg, c, "Kronen"), "wrong card")
        layout(s, c, "riven card")
        pg.locator(f"{c} .mantine-SegmentedControl-root label", has_text="Edit").click()
        pg.wait_for_timeout(300)
        pg.locator(c).get_by_label("Minimum price").fill("120")
        pg.locator(f"{c} [data-station-save]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "(h.state.stockRivens.find((r) => r.id === %d).properties || {}).min_price" % row["id"]) == 120, "riven minimum price not saved")
        pg.locator(f"{c} .mantine-SegmentedControl-root label", has_text="Sell").click()
        pg.wait_for_timeout(300)
        pg.locator(f"{c} [data-station-price] input, {c} input[data-station-price]").first.fill("150")
        pg.locator(f"{c} [data-station-sell]").click()
        pg.wait_for_timeout(1300)
        s.check(not H(pg, "h.state.stockRivens.some((r) => r.id === %d)" % row["id"]), "riven still in stock")
        s.check(H(pg, "h.state.transactions[0].price") == 150 and H(pg, "h.state.transactions[0].item_type") == "riven", "riven sale not recorded")
        esc(pg)
        nothing_open(s, "riven card")

    with s.step(f"station {tag}: riven case card, hide, show and delete"):
        row = open_stock_card(s, "riven", "h.state.stockRivens.find((r) => r.weapon_name === 'Soma')", "'Soma'", view)
        pg.locator(f"{c} .mantine-SegmentedControl-root label", has_text="Edit").click()
        pg.wait_for_timeout(300)
        pg.locator(f"{c} [data-station-hide]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "h.state.stockRivens.find((r) => r.id === %d).is_hidden" % row["id"]) is True, "riven not hidden")
        pg.locator(f"{c} [data-station-hide]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "h.state.stockRivens.find((r) => r.id === %d).is_hidden" % row["id"]) is False, "riven not shown again")
        pg.locator(f"{c} [data-station-delete]").click()
        pg.wait_for_timeout(300)
        pg.locator(f"{c} [data-station-delete]").click()
        pg.wait_for_timeout(1300)
        s.check(not H(pg, "h.state.stockRivens.some((r) => r.id === %d)" % row["id"]), "riven not deleted")
        esc(pg)
        nothing_open(s, "riven card")

    c = "[data-station-card=wish]"
    with s.step(f"station {tag}: wanted poster card, edit and bought"):
        map_go(s, "Wanted wall")
        row = open_stock_card(s, "wish", "h.state.wishList.find((w) => w.item_name === 'Arcane Grace')", "'Wanted: Arcane Grace'", view)
        s.check(text_visible(pg, c, "Arcane Grace"), "wrong card")
        layout(s, c, "wish card")
        pg.locator(f"{c} .mantine-SegmentedControl-root label", has_text="Edit").click()
        pg.wait_for_timeout(300)
        pg.locator(c).get_by_label("Maximum price").fill("21")
        pg.locator(f"{c} [data-station-save]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "h.state.wishList.find((w) => w.id === %d).properties.max_price" % row["id"]) == 21, "max price not saved")
        pg.locator(f"{c} .mantine-SegmentedControl-root label", has_text="Bought").click()
        pg.wait_for_timeout(300)
        pg.locator(c).get_by_label("Quantity").fill("2")
        pg.locator(f"{c} [data-station-price] input, {c} input[data-station-price]").first.fill("16")
        pg.locator(f"{c} [data-station-bought]").click()
        pg.wait_for_timeout(1300)
        bought = calls(pg, "wish_list_bought")[-1]["args"]
        s.check(bought["quantity"] == 2 and bought["price"] == 32, f"buying 2 at 16p each must reach the backend as quantity 2, price 32 (the total): got {bought}")
        s.check(not H(pg, "h.state.wishList.some((w) => w.id === %d)" % row["id"]), "wish list entry not completed")
        esc(pg)
        nothing_open(s, "wish card")

    with s.step(f"station {tag}: wanted poster card, hide, show and delete"):
        row = open_stock_card(s, "wish", "h.state.wishList.find((w) => w.item_name === 'Adaptation')", "'Wanted: Adaptation'", view)
        pg.locator(f"{c} .mantine-SegmentedControl-root label", has_text="Edit").click()
        pg.wait_for_timeout(300)
        pg.locator(f"{c} [data-station-hide]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "h.state.wishList.find((w) => w.id === %d).is_hidden" % row["id"]) is True, "entry not hidden")
        pg.locator(f"{c} [data-station-hide]").click()
        pg.wait_for_timeout(1100)
        s.check(H(pg, "h.state.wishList.find((w) => w.id === %d).is_hidden" % row["id"]) is False, "entry not shown again")
        pg.locator(f"{c} [data-station-delete]").click()
        pg.wait_for_timeout(300)
        pg.locator(f"{c} [data-station-delete]").click()
        pg.wait_for_timeout(1300)
        s.check(not H(pg, "h.state.wishList.some((w) => w.id === %d)" % row["id"]), "entry not deleted")
        esc(pg)
        nothing_open(s, "wish card")


def station_warehouse(s: Suite, view: str) -> None:
    pg = s.page
    tag = "first person" if view == "fp" else "top-down"
    c = "[data-station-card=item]"
    with s.step(f"station {tag}: warehouse crate card and List for sale"):
        map_go(s, "Inventory bays")
        pg.wait_for_timeout(600)
        name = "Octavia Prime Set"
        item = H(pg, "(() => { const i = h.state.owned.find((o) => o.item.name === '%s'); return { unique: i.item.uniqueName, url: i.item.wfmUrl, quantity: i.quantity }; })()" % name)
        if has_game(pg):
            rect = G(pg, "(g.layoutData.crates.find((c) => c.item.unique_name === '%s') || {}).rect || null" % item["unique"])
            if rect is None:
                # not every owned item fits on the racks: take the first crate that is there
                first = G(pg, "(() => { const c = g.layoutData.crates.find((x) => !x.listed); return { rect: c.rect, unique: c.item.unique_name, name: c.item.name, url: c.item.wfm_url, quantity: c.item.quantity }; })()")
                rect, name, item = first["rect"], first["name"], {"unique": first["unique"], "url": first["url"], "quantity": first["quantity"]}
            s.check(approach(s, rect, "crate", item["unique"]), f"could not reach the crate (E target is {target(pg)})")
            pg.screenshot(path=str(s.shots / f"{s.label}-detail-crate-prompt-{view}.png"))
            press_use(pg)
        else:
            pg.keyboard.press("Tab")
            pg.wait_for_selector(".vt-station-panel", timeout=4000)
        if has_game(pg):
            pg.wait_for_selector(c, timeout=5000)
            s.check(text_visible(pg, c, name), "wrong crate card")
            layout(s, c, "warehouse crate card")
            before = H(pg, "h.state.stockItems.length")
            pg.locator(f"{c} [data-station-list]").click()
            pg.wait_for_selector(f"{c} [data-station-listed], {c} [data-station-instock]", timeout=5000)
            create = calls(pg, "stock_item_create")[-1]["args"]["input"]
            s.check(create["raw"] == item["url"] and create["bought"] == 0 and create["quantity"] >= 1, f"listing payload wrong: {create}")
            s.check(H(pg, "h.state.stockItems.length") == before + 1, "item not added to stock")
            pg.wait_for_timeout(900)
            s.check(G(pg, "g.layoutData.crates.find((c) => c.item.unique_name === '%s').listed" % item["unique"]) is True, "crate not marked as listed")
            esc(pg)
            nothing_open(s, "crate card")

    if has_game(pg):
        with s.step(f"station {tag}: bay terminal card"):
            rect = pg.evaluate("async () => (await import('/src/station/engine/constants.ts')).terminalRect(0)")
            s.check(rect is not None, "terminalRect not found")
            if rect:
                s.check(approach(s, rect, "terminal"), f"could not reach the bay terminal (E target is {target(pg)})")
                press_use(pg)
                pg.wait_for_selector("[data-station-card=bay]", timeout=5000)
                layout(s, "[data-station-card=bay]", "bay card")
                esc(pg)

    q = ".vt-station-panel"
    with s.step(f"station {tag}: Tab stock list"):
        if pg.locator(q).count() == 0:
            pg.keyboard.press("Tab")
        pg.wait_for_selector(q, timeout=4000)
        pg.wait_for_timeout(500)
        s.check(pg.locator(f"{q} [data-station-row-list]").count() >= 10, "stock list rows missing")
        layout(s, q, "stock list")
        pg.locator(f"{q} [data-station-search]").fill("relic")
        pg.wait_for_timeout(400)
        s.check(pg.locator(f"{q} [data-station-row-list]").count() <= 6, "search does not filter")
        pg.locator(f"{q} [data-station-search]").fill("")
        pg.locator(f"{q} [data-station-sort]").first.click()
        pg.wait_for_timeout(300)

    with s.step(f"station {tag}: stock list, list one row"):
        before = H(pg, "h.state.stockItems.length")
        pg.locator(f"{q} [data-station-row-list]").first.click()
        pg.wait_for_timeout(1500)
        s.check(H(pg, "h.state.stockItems.length") == before + 1, "row not listed")

    with s.step(f"station {tag}: stock list, List top 5"):
        before = H(pg, "h.state.stockItems.length")
        n0 = len(calls(pg, "stock_item_create"))
        pg.locator(f"{q} [data-station-list-top]").click()
        pg.wait_for_function("(n) => window.__HARNESS__.calls.filter((x) => x.cmd === 'stock_item_create').length >= n + 5", arg=n0, timeout=10000)
        pg.wait_for_timeout(1500)
        s.check(H(pg, "h.state.stockItems.length") == before + 5, f"expected 5 new stock items, got {H(pg, 'h.state.stockItems.length') - before}")

    with s.step(f"station {tag}: stock list, rescan; Tab closes it"):
        n0 = len(calls(pg, "wf_inventory_update"))
        pg.locator(f"{q} [data-station-rescan]").click()
        pg.wait_for_timeout(900)
        s.check(len(calls(pg, "wf_inventory_update")) == n0 + 1, "rescan did not reach the backend")
        pg.locator(f"{q}").click(position={"x": 8, "y": 8})
        pg.keyboard.press("Tab")
        pg.wait_for_timeout(400)
        if pg.locator(q).count():
            esc(pg)
        s.check(pg.locator(q).count() == 0, "stock list did not close")


def station_overlays(s: Suite, view: str) -> None:
    pg = s.page
    tag = "first person" if view == "fp" else "top-down"
    with s.step(f"station {tag}: do-anything palette, search"):
        pg.keyboard.press("k")
        pg.wait_for_selector("[data-station-palette-input]", timeout=4000)
        s.check(pg.input_value("[data-station-palette-input]") == "", "the K key leaked into the search field")
        total = pg.locator("[data-station-command]").count()
        s.check(total >= 40, f"only {total} commands")
        layout(s, "[data-station-palette]", "palette")
        pos = G(pg, "[Math.round(g.player.x), Math.round(g.player.y)]") if has_game(pg) else None
        pg.keyboard.type("wasd vm")
        pg.wait_for_timeout(200)
        if pos:
            s.check(G(pg, "[Math.round(g.player.x), Math.round(g.player.y)]") == pos, "typing in the palette moved the player")
        pg.fill("[data-station-palette-input]", "glaive")
        pg.wait_for_timeout(300)
        s.check(pg.locator("[data-station-command]").count() < total and text_visible(pg, "[data-station-palette]", "Glaive Prime Set"), "search does not filter")

    runs = [
        ("settings", ('.vt-station-holo[data-station-panel="engineering"]', None)),
        ("trades left", ("[data-station-card=docks]", None)),
        ("Nova Prime Set", ("[data-station-card=stock]", "Nova Prime Set")),
        ("strategy", ("[data-station-card=manager]", None)),
        ("vault balance", ("[data-station-card=tank]", None)),
        ("warframe market", ('.vt-station-holo[data-station-panel="market"]', "Auctions")),
        ("go to the shop", (None, "shop")),
        ("inventory list", (".vt-station-panel", None)),
    ]
    for query, (selector, proof) in runs:
        with s.step(f"station {tag}: palette runs '{query}'"):
            if pg.locator("[data-station-palette-input]").count() == 0:
                pg.keyboard.press("/" if query == "settings" else "k")
                pg.wait_for_selector("[data-station-palette-input]", timeout=4000)
            pg.fill("[data-station-palette-input]", query)
            pg.wait_for_timeout(250)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(700)
            s.check(pg.locator("[data-station-palette]").count() == 0, "palette stayed open")
            if selector:
                s.check(pg.locator(selector).count() == 1, f"'{query}' did not open {selector}")
                if proof:
                    s.check(text_visible(pg, selector, proof), f"'{proof}' missing")
            elif proof:
                pg.wait_for_timeout(500)
                s.check(room_of(pg) == proof, f"room is {room_of(pg)}")
            no_error_boundary(s, f"palette {query}")
        esc(pg)
        if pg.locator(".vt-station-holo, .vt-station-overlay, .vt-station-panel").count():
            esc(pg)

    with s.step(f"station {tag}: palette starts and stops the trader"):
        for want in (True, False):
            pg.keyboard.press("k")
            pg.wait_for_selector("[data-station-palette-input]", timeout=4000)
            pg.fill("[data-station-palette-input]", "live trader")
            pg.wait_for_timeout(250)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(500)
            if want:
                pg.locator(".mantine-Modal-content").get_by_role("button", name="Start").click()
            pg.wait_for_timeout(600)
            s.check(H(pg, "h.state.running") is want, f"trader running should be {want}")

    with s.step(f"station {tag}: help overlay"):
        pg.keyboard.press("h")
        pg.wait_for_selector("[data-station-help]", timeout=4000)
        layout(s, "[data-station-help]", "help overlay")
        s.check(pg.locator("[data-station-start-switch]").count() == 1, "start switch missing")
    with s.step(f"station {tag}: help overlay switches (start in station, low power)"):
        sw = pg.locator("[data-station-start-switch]")
        sw.click(force=True)
        pg.wait_for_timeout(300)
        s.check(pg.evaluate("() => localStorage.getItem('vt_station_start')") == "0", "start switch off not stored")
        sw.click(force=True)
        pg.wait_for_timeout(300)
        s.check(pg.evaluate("() => localStorage.getItem('vt_station_start')") == "1", "start switch on not stored")
        pg.locator("[data-station-help]").get_by_text("Low power", exact=False).click(force=True)
        pg.wait_for_timeout(400)
        s.check(pg.evaluate("() => localStorage.getItem('vt_station_low_power')") == "1", "low power not stored")
        pg.locator("[data-station-help]").get_by_text("Low power", exact=False).click(force=True)
        pg.wait_for_timeout(300)
        pg.keyboard.press("h")
        pg.wait_for_timeout(300)
        if pg.locator("[data-station-help]").count():
            esc(pg)
        s.check(pg.locator("[data-station-help]").count() == 0, "help did not close")

    with s.step(f"station {tag}: footer buttons (map, do anything, stock list, help, view)"):
        for sel, opened in (("[data-station-map-button]", "[data-station-map]"), ("[data-station-palette-button]", "[data-station-palette]"), ("[data-station-help-button]", "[data-station-help]"), ("[data-station-quick]", ".vt-station-panel")):
            pg.locator(sel).click()
            pg.wait_for_timeout(450)
            s.check(pg.locator(opened).count() == 1, f"{sel} did not open {opened}")
            esc(pg)
            if pg.locator(opened).count():
                esc(pg)
            s.check(pg.locator(opened).count() == 0, f"{opened} did not close")
        before = pg.evaluate("() => localStorage.getItem('vt_station_view')")
        pg.locator("[data-station-view]").click()
        pg.wait_for_timeout(600)
        s.check(pg.evaluate("() => localStorage.getItem('vt_station_view')") != before, "view button did nothing")
        pg.locator("[data-station-view]").click()
        pg.wait_for_timeout(600)


def station_buyers(s: Suite, view: str) -> None:
    pg = s.page
    tag = "first person" if view == "fp" else "top-down"
    c = "[data-station-card=customer]"
    game = has_game(pg)

    def serve() -> None:
        if game:
            pg.wait_for_function("() => window.__vtStation.nextBuyer !== null", timeout=8000)
            pg.wait_for_timeout(3500)  # let the customer walk in
        else:
            pg.wait_for_timeout(4500)
        map_go(s, "Trade desk")
        press_use(pg)
        if pg.locator(c).count() == 0:
            esc(pg)
            pg.keyboard.press("k")
            pg.fill("[data-station-palette-input]", "serve")
            pg.keyboard.press("Enter")
        pg.wait_for_selector(c, timeout=5000)

    with s.step(f"station {tag}: a warframe.market chat message brings a buyer to the desk"):
        map_go(s, "Plat tank")
        n0 = len(calls(pg, "get_chat_pagination"))
        H(pg, "h.chatMessage(1, 'Hi! I want to buy: \"Glaive Prime Set\" for 160 platinum. (warframe.market)')")
        pg.wait_for_timeout(800)
        s.check(len(calls(pg, "get_chat_pagination")) == n0 + 1, "the station did not look up who wrote")
        if game:
            pg.wait_for_function("() => window.__vtStation.nextBuyer !== null", timeout=6000)
            s.check(G(pg, "g.nextBuyer.name") == "VoidRunner77", f"buyer is {G(pg, 'g.nextBuyer && g.nextBuyer.name')}")
            s.check(G(pg, "g.alerts.get('comms')") is True, "comms terminal is not flashing although there are unread messages")
        s.check(pg.locator("nav .mantine-Indicator-indicator").first.inner_text().strip() == "3", "unread badge in the side bar not updated")
        pg.wait_for_timeout(2500)

    with s.step(f"station {tag}: own messages do not create a buyer"):
        if game:
            before = G(pg, "g.customers.all.length")
            H(pg, "h.emitMessage('Wfm:OnChatMessage', { id: 'x1', chat_id: h.state.chats[0].id, message: 'on my way', raw_message: 'on my way', message_from: h.state.user.wfm_id, send_date: new Date().toISOString(), requirer_refresh: false })")
            pg.wait_for_timeout(900)
            s.check(G(pg, "g.customers.all.length") == before, "my own chat message was treated as a buyer")

    with s.step(f"station {tag}: customer card, copy whisper and invite"):
        serve()
        s.check(text_visible(pg, c, "VoidRunner77"), "buyer name missing")
        s.check(text_visible(pg, c, "Glaive Prime Set"), "buyer message missing")
        layout(s, c, "customer card")
        pg.locator(f'{c} [data-station-copy="Copy whisper"]').click()
        pg.wait_for_timeout(400)
        s.check(H(pg, "h.state.clipboard") == "/w VoidRunner77 " or "VoidRunner77" in (H(pg, "h.state.clipboard") or ""), f"whisper command not on the clipboard: {H(pg, 'h.state.clipboard')!r}")
        pg.locator(f'{c} [data-station-copy="Copy invite"]').click()
        pg.wait_for_timeout(400)
        s.check("VoidRunner77" in (H(pg, "h.state.clipboard") or "") and "inv" in (H(pg, "h.state.clipboard") or "").lower(), f"invite command not on the clipboard: {H(pg, 'h.state.clipboard')!r}")
        s.check(len([x for x in H(pg, "h.denied") if "clipboard" in x["cmd"]]) == 0, "clipboard write is not allowed by the app's capabilities")

    with s.step(f"station {tag}: record the sale from the customer card"):
        sale = f"{c} [data-station-record-sale]"
        s.check(pg.locator(sale).count() == 1, "record-sale block missing")
        picked = pg.locator(f"{sale} input").first.input_value()
        s.check("Glaive Prime Set" in picked, f"the item from the buyer's message was not pre-picked (got {picked!r})")
        owned0 = H(pg, "h.state.stockItems.find((i) => i.item_name === 'Glaive Prime Set').owned")
        tx0 = H(pg, "h.state.transactions.length")
        pg.locator(sale).get_by_label("Sold for (each)").fill("160")
        pg.locator(f"{sale} [data-station-sell]").click()
        pg.wait_for_selector(f"{sale} [data-station-done-note]", timeout=5000)
        s.check(H(pg, "(h.state.stockItems.find((i) => i.item_name === 'Glaive Prime Set') || { owned: 0 }).owned") == owned0 - 1, "stock not reduced")
        s.check(H(pg, "h.state.transactions.length") == tx0 + 1 and H(pg, "h.state.transactions[0].price") == 160, "sale not recorded at 160p")
        pg.wait_for_timeout(1200)
        pg.locator(f"{c} [data-station-done]").click()
        pg.wait_for_timeout(600)
        nothing_open(s, "customer card")
        if game:
            pg.wait_for_timeout(800)
            s.check(G(pg, "g.nextBuyer") is None, "the served customer is still waiting")
            s.check(G(pg, "g.goal.platinum") == H(pg, "h.state.platinum"), f"vault shows {G(pg, 'g.goal.platinum')}p, backend has {H(pg, 'h.state.platinum')}p")

    with s.step(f"station {tag}: an in-game whisper (vt_whisper) brings a buyer"):
        delivered = H(pg, "h.whisper('SteelPathSam')")
        s.check(delivered == 1, f"vt_whisper has {delivered} listeners, expected exactly 1")
        serve()
        s.check(text_visible(pg, c, "SteelPathSam"), "whisper buyer missing")
        s.check(text_visible(pg, c, "whisper"), "whisper note missing")
        pg.screenshot(path=str(s.shots / f"{s.label}-detail-whisper-customer-{view}.png"))
        esc(pg)
        nothing_open(s, "whisper customer")

    with s.step(f"station {tag}: a finished trade (add_trade) pours into the tank"):
        map_go(s, "Plat tank")
        if game and view == "fp":
            # step back so the tank is in view
            pg.evaluate("async () => { const c = await import('/src/station/engine/constants.ts'); const x = c.TANK_FRAME.x + c.TANK_FRAME.w / 2, y = c.TANK_GLASS.y + 26; const px = x + 120, py = y + 110; window.__vtStation.travelTo(px, py, Math.atan2(y - py, x - px)); }")
            pg.wait_for_timeout(400)
        plat0 = H(pg, "h.state.platinum")
        delivered = H(pg, "h.trade('StarHollow', 78, 'Sale')")
        s.check(delivered == 1, f"add_trade has {delivered} listeners, expected exactly 1")
        pg.wait_for_timeout(500)
        s.check(text_visible(pg, ".vt-station-root", "+78"), "no '+78p' floater")
        if game:
            s.check(G(pg, "g.floaters.length") >= 1, "no floater in the game")
        pg.screenshot(path=str(s.shots / f"{s.label}-detail-sale-surge-{view}.png"))
        pg.wait_for_timeout(2200)
        s.check(H(pg, "h.state.platinum") == plat0 + 78, "mock balance")
        if game:
            s.check(G(pg, "g.goal.platinum") == plat0 + 78, f"vault did not catch up: {G(pg, 'g.goal.platinum')}")
        if view == "top":
            s.check(text_visible(pg, ".vt-station-root", f"{plat0 + 78}p"), "readout not updated")

    with s.step(f"station {tag}: a purchase trade does not celebrate"):
        H(pg, "h.trade('Orren_Vask', 20, 'Purchase', 'Blind Rage')")
        pg.wait_for_timeout(1800)
        s.check(not text_visible(pg, ".vt-station-root", "+20", timeout=500), "a purchase showed a gain")


def scenario_safety(s: Suite) -> None:
    """The safety nets. The ship: a page that crashes inside a terminal is contained; no WebGL, no
    first frame or a crash of the game itself opens the classic view (never a dead end). The old
    station: a page that crashes inside a panel, and the station itself crashing."""
    crash = [r"Cannot read properties of null", r"The above error occurred", r"\[station\] crashed", r"\[game\]", r"\[shell\]", r"test fault", r"React will try to recreate", r"error boundary", r"Unhandled error", r"An error occurred in"]
    with s.step("safety: a page that crashes inside a Service Deck terminal does not take the ship down", allow=crash):
        pg = s.open(1280, 800, options={"corrupt": "orders"}, storage=SHIP)
        wait_game(s)
        pg.evaluate("() => { const g = window.__vtGame; g.goToTerminal('market'); g.engine.screens.dock('svc-market'); }")
        game_steps(pg, 30)
        pg.wait_for_selector("[data-screen='svc-market'] [data-vtg-term-fault]", state="attached", timeout=60000)
        s.check(pg.locator("[data-vtg-host]").count() == 1 and pg.locator("nav button").count() == 0, "the ship went down with the terminal")
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") != "1", "a terminal crash switched to the classic view")
        pg.keyboard.press("Escape")
        game_steps(pg, 30)
    with s.step("safety: the ship keeps working after a terminal crashed"):
        pg.evaluate("() => { const g = window.__vtGame; g.goToTerminal('home'); g.engine.screens.dock('svc-home'); }")
        game_steps(pg, 30)
        pg.wait_for_selector("[data-vtg-term-page=home]", state="attached", timeout=60000)
        s.check(text_visible(pg, "[data-vtg-term-page=home]", "Total Profit", timeout=60000), "another terminal does not open any more")
    for fault, why, extra in (("webgl", "WebGL unavailable", {}), ("stall", "no first frame", {"vt_game_watchdog_ms": "1500"}), ("crash", "crash", {})):
        with s.step(f"safety: game fault '{fault}' opens the classic view, with trades reachable", allow=crash):
            pg = s.open(1280, 800, storage={**SHIP, **extra, "vt_game_test_fault": fault})
            pg.set_default_timeout(60000)
            wait_app(s, timeout=120000)
            s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") == "1", "the fallback was not remembered")
            reason = pg.evaluate("() => localStorage.getItem('vt_classic_reason')") or ""
            s.check(why in reason, f"fallback reason is '{reason}'")
            s.check(pg.locator("[data-vtg-host]").count() == 0, "the broken game is still mounted")
            s.check(text_visible(pg, "body", "The ship could not start"), "the owner is not told why the classic view opened")
            s.check("Unexpected Application Error" not in pg.evaluate("() => document.body.innerText"), "router error page")
            close_notifications(pg)
            nav(s, "live_scraper")
            s.check(text_visible(pg, ".mantine-AppShell-main", "Glaive Prime Set", timeout=40000), "trades not reachable in the fallback")
    with s.step("safety: a page that crashes inside a panel does not take the station down", allow=crash):
        pg = s.open(1280, 800, options={"corrupt": "orders"})
        enter_station(s)
        open_panel(s, "market", "Market terminal")
        s.check(text_visible(pg, ".vt-station-holo-body", "could not be shown here"), "the panel's error boundary did not catch the crash")
        s.check("The station hit an error" not in pg.evaluate("() => document.body.innerText"), "the whole station went down")
        esc(pg)
        nothing_open(s, "crashed panel")
    with s.step("safety: the station keeps working after a panel crashed"):
        open_panel(s, "overview", "Overview screen")
        s.check(text_visible(pg, ".vt-station-holo-body", "Total Profit"), "another panel does not open any more")
        esc(pg)
        if has_game(pg):
            s.check(G(pg, "g.app.ticker.started") is True, "the station did not resume")
        s.check(pg.evaluate("() => localStorage.getItem('vt_station_start')") != "0", "a panel crash switched the station start off")

    with s.step("safety: a crash of the station itself shows the way out and turns the station start off", allow=crash):
        pg = s.open(1280, 800, options={"corrupt": "stock"})
        wait_app(s)
        nav(s, "station")
        pg.wait_for_function("() => document.body.innerText.includes('The station hit an error')", timeout=15000)
        s.check(pg.evaluate("() => localStorage.getItem('vt_station_start')") == "0", "the station start was not switched off after the crash")
        s.check(pg.locator("nav button").count() >= 9, "the side bar is gone: no way out")
        s.check(pg.get_by_role("link", name="Go to the classic view").count() == 1, "no link to the classic view")
    with s.step("safety: after a station crash the app opens in the classic view", allow=crash):
        pg.get_by_role("link", name="Go to the classic view").click()
        wait_app(s)
        pg.wait_for_timeout(800)
        s.check(pg.evaluate("() => location.pathname") == "/", f"landed on {pg.url}")
        s.check(text_visible(pg, ".mantine-AppShell-main", "Total Profit"), "Home did not render")
    with s.step("safety: the side bar still leaves a crashed station", allow=crash):
        nav(s, "station")
        pg.wait_for_function("() => document.body.innerText.includes('The station hit an error')", timeout=15000)
        nav(s, "about")
        s.check(text_visible(pg, ".mantine-AppShell-main", "Version"), "About did not render after leaving the crashed station")


def scenario_remount(s: Suite) -> None:
    with s.step("remount: baseline in the station"):
        pg = s.open(1280, 800)
        enter_station(s)
        pg.wait_for_timeout(800)
    base = {
        "canvases": pg.locator("canvas").count(),
        "stages": pg.locator(".vt-station-stage").count(),
        "tauri": H(pg, "h.listeners()"),
        "dom": H(pg, "h.domListeners()"),
        "bus": pg.evaluate("() => window.api.events.listener.getSize()"),
    }
    with s.step("remount: one canvas set, one stage", shot=False):
        s.check(base["stages"] == 1, f"{base['stages']} stages")
        s.check(base["canvases"] <= 3, f"{base['canvases']} canvases in the station")
    for i, away in enumerate(["home", "live_scraper", "chat", "wf_inventory", "trading_analytics", "home"]):
        with s.step(f"remount {i + 1}: station -> {away} -> station"):
            nav(s, away)
            s.check(pg.locator(".vt-station-stage").count() == 0, "stage left behind")
            s.check(pg.locator(".vt-station-root canvas").count() == 0, "canvas left behind")
            gone = H(pg, "h.listeners()")
            s.check(gone.get("add_trade", 0) == 0 and gone.get("vt_whisper", 0) == 0, f"station listeners still registered after leaving: {gone}")
            nav(s, "station")
            station_ready(s)
            no_error_boundary(s, "remount")
            now = {
                "canvases": pg.locator("canvas").count(),
                "stages": pg.locator(".vt-station-stage").count(),
                "tauri": H(pg, "h.listeners()"),
                "dom": H(pg, "h.domListeners()"),
                "bus": pg.evaluate("() => window.api.events.listener.getSize()"),
            }
            s.check(now["stages"] == 1 and now["canvases"] == base["canvases"], f"canvases/stages changed: {now['canvases']}/{now['stages']} vs {base['canvases']}/{base['stages']}")
            s.check(now["tauri"] == base["tauri"], f"backend event listeners changed: {now['tauri']} vs {base['tauri']}")
            grown = {k: (base["dom"].get(k, 0), v) for k, v in now["dom"].items() if v > base["dom"].get(k, 0)}
            s.check(not grown, f"window/document listeners grew: {grown}")
            s.check(now["bus"] == base["bus"], f"app event bus listeners changed: {now['bus']} vs {base['bus']}")
    with s.step("remount: events still arrive exactly once afterwards"):
        s.check(H(pg, "h.whisper('RemountCheck')") == 1, "vt_whisper listener count")
        s.check(H(pg, "h.trade('StarHollow', 11, 'Sale')") == 1, "add_trade listener count")
        pg.wait_for_timeout(1500)
        if has_game(pg):
            s.check(G(pg, "g.customers.all.filter((c) => c.buyer.name === 'RemountCheck').length") == 1, "the whisper created more or fewer than one customer")
    with s.step("remount: panel open while leaving, then back"):
        open_panel(s, "live", "Stock desk")
        nav(s, "about")
        nav(s, "station")
        station_ready(s)
        nothing_open(s, "after returning")
        no_error_boundary(s, "after returning")
    with s.step("remount: browser reload inside the station"):
        # the station is not a start page any more: a reload comes up in the classic view
        pg.reload()
        enter_station(s)
        no_error_boundary(s, "reload")


def scenario_layout(s: Suite, w: int, h: int, classic: bool = True, alerts: bool = True) -> None:
    """Sizes: every classic page and every holo panel must fit, scroll, and reach its last row."""
    tag = f" {w}x{h}" + ("" if alerts else " no alerts")
    if classic:
        scenario_classic(s, w, h, tag)
    with s.step(f"layout{tag}: station"):
        pg = s.open(w, h, options={"alerts": alerts})
        enter_station(s)
        root = pg.locator(".vt-station-root").bounding_box()
        foot = pg.locator(".vt-station-footer").bounding_box()
        stage = pg.locator(".vt-station-stage").bounding_box()
        s.check(foot["y"] + foot["height"] <= h + 1, f"station footer is below the window ({foot['y'] + foot['height']:.0f} > {h})")
        s.check(root["y"] >= (104 if alerts else 64), "station starts under the header or the alert ticker")
        s.check(stage["width"] > 400 and stage["y"] + stage["height"] <= foot["y"] + 1, "station view overlaps its footer")
        layout(s, ".vt-station-footer", "station footer")
    for panel_id, place, proof, control, after in PANELS:
        with s.step(f"layout{tag}: {panel_id} panel fits and scrolls"):
            pg.keyboard.press("k")
            pg.wait_for_selector("[data-station-palette-input]", timeout=4000)
            pg.locator(f'[data-station-command="panel-{panel_id}"]').click()
            scope = f'.vt-station-holo[data-station-panel="{panel_id}"] .vt-station-holo-body'
            pg.wait_for_selector(scope, timeout=6000)
            s.check(text_visible(pg, scope, proof), f"'{proof}' missing")
            pg.wait_for_timeout(900)
            holo = pg.locator(".vt-station-holo").bounding_box()
            s.check(holo["y"] + holo["height"] <= h + 1 and holo["x"] + holo["width"] <= w + 1, "panel larger than the window")
            layout(s, scope, f"{panel_id} panel")
            # the page inside must not be taller than the panel unless the panel can scroll to it
            fit = pg.evaluate(
                """(sel) => { const b = document.querySelector(sel); const r = b.getBoundingClientRect(); let worst = 0, who = '';
                   for (const el of b.querySelectorAll('*')) { const cs = getComputedStyle(el); if (cs.display === 'none') continue; const q = el.getBoundingClientRect(); if (q.height < 2 || q.width < 2) continue;
                     let inScroller = false; for (let n = el.parentElement; n && n !== b; n = n.parentElement) { const s = getComputedStyle(n); if ((s.overflowY === 'auto' || s.overflowY === 'scroll' || s.overflowY === 'hidden') ) { inScroller = true; break; } }
                     if (!inScroller && q.bottom - r.bottom > worst) { worst = q.bottom - r.bottom; who = el.tagName + '.' + String(el.className).slice(0, 50); } }
                   return { overflow: Math.round(worst), who, scrollable: b.scrollHeight > b.clientHeight + 1, body: [Math.round(r.height), b.scrollHeight] }; }""",
                scope,
            )
            s.check(fit["overflow"] <= 2 or fit["scrollable"], f"content sticks out {fit['overflow']}px below the panel and the panel does not scroll ({fit['who']})")
            pg.screenshot(path=str(s.shots / f"{s.label}-panel-{panel_id}-{w}x{h}{'' if alerts else '-no-alerts'}.png"))
            esc(pg)
            if pg.locator(".vt-station-holo").count():
                pg.locator(".vt-station-holo-bar").click(position={"x": 5, "y": 5})
                esc(pg)
    with s.step(f"layout{tag}: stock desk, strategy expanded inside the panel"):
        pg.keyboard.press("k")
        pg.wait_for_selector("[data-station-palette-input]", timeout=4000)
        pg.locator('[data-station-command="panel-live"]').click()
        scope = '.vt-station-holo[data-station-panel="live"] .vt-station-holo-body'
        pg.wait_for_selector(scope, timeout=6000)
        toggle = pg.locator(scope).get_by_role("button", name="presets and activity")
        if "Show" in toggle.inner_text():
            toggle.click()
        pg.wait_for_timeout(800)
        layout(s, scope, "stock desk with strategy expanded")
        pg.screenshot(path=str(s.shots / f"{s.label}-panel-live-strategy-expanded-{w}x{h}{'' if alerts else '-no-alerts'}.png"))
        table = pg.locator(f"{scope} tbody tr").last
        table.scroll_into_view_if_needed()
        pg.wait_for_timeout(300)
        box = table.bounding_box()
        holo = pg.locator(scope).bounding_box()
        s.check(box is not None and box["y"] + box["height"] <= holo["y"] + holo["height"] + 1, "the last stock row cannot be reached with the strategy expanded")
        toggle = pg.locator(scope).get_by_role("button", name="presets and activity")
        toggle.scroll_into_view_if_needed()
        toggle.click()
        esc(pg)
        if pg.locator(".vt-station-holo").count():
            pg.locator(".vt-station-holo-bar").click(position={"x": 5, "y": 5})
            esc(pg)
    with s.step(f"layout{tag}: cards and overlays fit"):
        for query, sel in (("strategy", "[data-station-card=manager]"), ("vault balance", "[data-station-card=tank]"), ("Nova Prime Set", "[data-station-card=stock]")):
            pg.keyboard.press("k")
            pg.wait_for_selector("[data-station-palette-input]", timeout=4000)
            pg.fill("[data-station-palette-input]", query)
            pg.keyboard.press("Enter")
            pg.wait_for_selector(sel, timeout=5000)
            pg.wait_for_timeout(500)
            b = pg.locator(sel).bounding_box()
            s.check(b["y"] >= 0 and b["y"] + b["height"] <= h + 1, f"{sel} does not fit ({b})")
            layout(s, sel, sel)
            pg.screenshot(path=str(s.shots / f"{s.label}-overlay-{query.replace(' ', '-').lower()}-{w}x{h}{'' if alerts else '-no-alerts'}.png"))
            esc(pg)
        for key, sel in (("m", "[data-station-map]"), ("h", "[data-station-help]"), ("Tab", ".vt-station-panel")):
            pg.keyboard.press(key)
            pg.wait_for_selector(sel, timeout=5000)
            pg.wait_for_timeout(400)
            layout(s, sel, sel)
            esc(pg)


def scenario_dist(s: Suite) -> None:
    """The production bundle (dist/): boots, every route and every station panel renders."""
    main = ".mantine-AppShell-main"
    with s.step("dist: boots into the ship (the 3D game), nothing else on screen"):
        pg = s.open(1280, 800, storage=SHIP)
        pg.set_default_timeout(60000)
        pg.wait_for_selector("canvas.vtg-canvas", state="attached", timeout=120000)
        pg.wait_for_selector("[class*=splashScreen]", state="detached", timeout=30000)
        pg.wait_for_function("() => window.__HARNESS__.counts['vt_plat_goal'] > 0", timeout=60000)
        pg.wait_for_selector("[data-screen='svc-live'] [data-vtg-term-idle]", state="attached", timeout=60000)
        s.check(pg.evaluate("() => !window.__vtGame"), "the dev-only game handle is present in the production bundle")
        s.check(pg.locator("nav button").count() == 0 and pg.locator(".mantine-AppShell-root").count() == 0, "the classic app frame is mounted in the ship")
        s.check(pg.evaluate("() => localStorage.getItem('vt_classic_mode')") != "1", "the ship fell back to the classic view")
        no_error_boundary(s, "dist boot")
    with s.step("dist: the key chord opens the classic view; the station is reached from its side bar"):
        pg.keyboard.press("Control+Shift+F12")
        pg.wait_for_selector("[data-vtg-host]", state="detached", timeout=20000)
        pg.set_default_timeout(10000)
        enter_station(s)
        no_error_boundary(s, "dist station")
        s.check(not has_game(pg), "the dev-only game handle is present in the production bundle")
        s.check(pg.locator(".vt-station-footer").get_by_text("Demo data").count() == 0, "demo data badge in the production bundle")
        s.check(pg.locator("[data-station-command^='debug-']").count() == 0, "debug commands exposed")
    for target, proof in (("home", "Total Profit"), ("live_scraper", "Glaive Prime Set"), ("warframe_market", "Sell Order"), ("chat", "VoidRunner77"), ("trading_analytics", "Created At"), ("wf_inventory", "trades left today"), ("trade_messages", "Glaive Prime Set"), ("about", "Version")):
        with s.step(f"dist: classic {target}"):
            nav(s, target)
            s.check(text_visible(pg, main, proof), f"'{proof}' missing")
            layout(s, main, target)
    with s.step("dist: debug page appears with Shift"):
        s.check(pg.locator("nav button").count() == len(NAV) - 1, "debug link visible without Shift")
        pg.keyboard.press("Shift")
        pg.wait_for_timeout(300)
        s.check(pg.locator("nav button").count() == len(NAV), "Shift did not reveal the debug link")
        nav(s, "debug")
        s.check(text_visible(pg, main, "Add Log"), "debug page missing")
        pg.keyboard.press("Shift")
    with s.step("dist: back to the station"):
        nav(s, "station")
        station_ready(s)
        no_error_boundary(s, "dist station")
    for room in ("warehouse", "bridge", "shop", "vault"):
        with s.step(f"dist: room {room}"):
            pg.keyboard.press("m")
            pg.wait_for_selector("[data-station-map]", timeout=5000)
            pg.locator(f'[data-station-map-room="{room}"]').click()
            pg.wait_for_timeout(800)
            s.check(room_of(pg) == room, f"room is {room_of(pg)}")
    for panel_id, place, proof, control, after in PANELS:
        with s.step(f"dist: {place} opens the real {panel_id} page", allow=[r"plugin:process"] if panel_id == "about" else None):
            open_panel(s, panel_id, place)
            check_panel(s, panel_id, proof, control, after, "dist")
            close_notifications(pg)
            pg.locator(".vt-station-holo-bar").click(position={"x": 5, "y": 5})
            esc(pg)
            if pg.locator(".vt-station-holo").count():
                esc(pg)
            nothing_open(s, panel_id)
    with s.step("dist: first person"):
        pg.keyboard.press("v")
        pg.wait_for_timeout(900)
        s.check(pg.locator(".vt-station-canvas-fp").is_visible(), "first-person canvas not visible")
        open_panel(s, "market", "Market terminal")
        s.check(text_visible(pg, ".vt-station-holo-body", "Auctions"), "market page missing")
        esc(pg)
        pg.keyboard.press("v")
    with s.step("dist: lever, stock card through the palette, buyer and sale events"):
        map_go(s, "Trader lever")
        press_use(pg)
        pg.locator(".mantine-Modal-content").get_by_role("button", name="Start").click()
        pg.wait_for_timeout(600)
        s.check(H(pg, "h.state.running") is True, "trader not started")
        press_use(pg)
        pg.wait_for_timeout(500)
        s.check(H(pg, "h.state.running") is False, "trader not stopped")
        open_stock_card(s, "stock", "h.state.stockItems.find((i) => i.item_name === 'Nova Prime Set')", "'Nova Prime Set'", "dist")
        pg.locator("[data-station-card=stock] [data-station-sell-auto]").click()
        pg.wait_for_timeout(1200)
        s.check(len(calls(pg, "stock_item_sell")) == 1, "sale not sent")
        esc(pg)
        map_go(s, "Plat tank")
        s.check(H(pg, "h.whisper('DistBuyer')") == 1, "vt_whisper listener count")
        s.check(H(pg, "h.trade('StarHollow', 40, 'Sale')") == 1, "add_trade listener count")
        pg.wait_for_timeout(600)
        s.check(text_visible(pg, ".vt-station-root", "+40"), "no sale floater")
        no_error_boundary(s, "dist events")


def V(pg, expr: str):
    """Evaluate against the 3D game's dev handle (window.__vtGame, src/game/GameCore.tsx)."""
    return pg.evaluate("() => { const g = window.__vtGame; if (!g) return null; return %s; }" % expr)


def game_steps(pg, n: int = 10) -> None:
    """Advance the game deterministically (the engine is stopped; software WebGL is slow) and render once."""
    pg.evaluate("(n) => { const e = window.__vtGame.engine; for (let i = 0; i < n; i++) e.step(0.05, false); e.step(0.016); }", n)


def scenario_game(s: Suite) -> None:
    """The 3D game (the app's shell) on the real app with the mock: walk from the Vault to the Market Observatory,
    focus a star, raise its order book on the spire, see an undercut, dock the Market Console, use
    search and filters, route an app modal onto the Comms display, and leave the route cleanly."""
    with s.step("game: boots on /game with the market overview"):
        pg = s.open(1280, 800, storage=SHIP)
        # software WebGL plus the 3D-transformed DOM layer make every composited frame slow here:
        # in-world controls are clicked with dispatched events, and waits are generous
        wait_game(s)
        pg.wait_for_function("() => window.__vtGame && window.__vtGame.market.state.market", timeout=60000)
        n = V(pg, "g.market.state.market.overview.items.length")
        s.check(n and n > 1200, f"only {n} stars in the overview")
        s.check(len(calls(pg, "vt_market_overview")) >= 1, "vt_market_overview never called")
        s.check(V(pg, "g.where") == "vault", "did not start in the vault")
        game_steps(pg, 5)
    with s.step("game: walks north through the arch and the corridor into the observatory"):
        pg.evaluate("() => { const g = window.__vtGame; g.place(0.2, -8, 0); g.engine.player.pitch = 0; g.engine.input.keys.add('KeyW'); }")
        for _ in range(8):
            game_steps(pg, 20)
            if V(pg, "g.where") == "observatory" and V(pg, "g.engine.player.pos.z") < -24:
                break
        pg.evaluate("() => window.__vtGame.engine.input.keys.clear()")
        game_steps(pg, 4)
        s.check(V(pg, "g.where") == "observatory", f"player ended in {V(pg, 'g.where')} at z={V(pg, 'g.engine.player.pos.z')}")
    url = "nova_prime_set"
    with s.step("game: looks at a star and presses E to focus it"):
        pos = V(pg, f"g.observatory.orrery.starWorld('{url}')")
        s.check(pos is not None, "star not in the sky")
        pg.evaluate("""(p) => { const g = window.__vtGame; const cz = g.observatory.root.position.z; const dx = p.x, dz = p.z - cz; const d = Math.hypot(dx, dz) || 1;
            g.place(dx / d * (d + 2.4), cz + dz / d * (d + 2.4), 0); g.aimAt(p.x, p.y, p.z); }""", pos)
        game_steps(pg, 3)
        s.check(V(pg, "g.market.hovered") == url, f"reticle hovers {V(pg, 'g.market.hovered')}")
        pg.keyboard.press("KeyE")
        pg.wait_for_function("(u) => { const f = window.__vtGame.market.state.focus; return f && f.wfm_url === u && window.__vtGame.market.state.book; }", arg=url, timeout=15000)
        s.check(len(calls(pg, "vt_order_book")) >= 1, "vt_order_book never called")
        pg.wait_for_function("() => window.__vtGame.market.state.history", timeout=15000)
        s.check(V(pg, "g.market.state.history.points.length") > 10, "no price history on the ribbon")
    with s.step("game: the spire rises with the order book and the ribbon"):
        vp = V(pg, "g.observatory.viewpoint")
        pg.evaluate("(v) => { const g = window.__vtGame; g.place(v.x, v.z, 0); g.engine.player.pitch = 0.1; }", vp)
        game_steps(pg, 50)
        b = V(pg, "g.market.state.book.summary")
        s.check(b["own_sell"] is not None and b["undercut_by"] is None, f"own order should lead: {b}")
    with s.step("game: an undercut dims your slab and slides a red one in below it"):
        s.check(H(pg, f"h.marketUndercut('{url}', 3)") is True, "no own order to undercut")
        before = len(calls(pg, "vt_order_book"))
        pg.evaluate("() => window.__vtGame.market.refresh()")
        pg.wait_for_function("() => { const b = window.__vtGame.market.state.book; return b && b.summary.undercut_by; }", timeout=15000)
        s.check(len(calls(pg, "vt_order_book")) > before, "refresh did not read the book again")
        s.check(V(pg, "g.market.state.book.summary.undercut_by") == 3, "undercut amount")
        game_steps(pg, 8)
        s.check(V(pg, "g.market.undercutActive") is True, "spire shows no undercut animation")
    with s.step("game: docks the Market Console beside the spire"):
        pg.evaluate("() => window.__vtGame.engine.screens.dock('market')")
        game_steps(pg, 30)
        s.check(V(pg, "g.engine.screens.docked && g.engine.screens.docked.id") == "market", "console not docked")
        s.check("Nova Prime Set" in pg.locator("[data-vtg-market-focus]").inner_text(), "console shows another item")
        s.check(pg.locator("[data-vtg-market-own]").count() == 1 and "undercut" in pg.locator("[data-vtg-market-own]").inner_text(), "own order line missing")
    with s.step("game: search flies the focus, filters dim the sky"):
        pg.fill("[data-vtg-market-search]", "Glaive Prime Set")
        pg.locator("[data-vtg-market-item='Glaive Prime Set']").first.dispatch_event("click")
        pg.wait_for_function("() => window.__vtGame.market.state.focus.wfm_url === 'glaive_prime_set'", timeout=8000)
        pg.locator("[data-vtg-filter='mine']").dispatch_event("click")
        pg.wait_for_function("() => window.__vtGame.market.state.filter.mine === true", timeout=5000)
        game_steps(pg, 4)
        s.check(V(pg, "g.observatory.orrery.count") > 1200, "sky emptied by the filter")
        pg.locator("[data-vtg-filter='mine']").dispatch_event("click")
    with s.step("game: stock actions of the focused item (the station's own card)"):
        pg.locator("[data-vtg-market-open-stock]").dispatch_event("click")
        pg.wait_for_selector("[data-vtg-market-detail] button:has-text('Close')", state="attached", timeout=10000)
        s.check(pg.locator("[data-vtg-market-detail] button:has-text('Close (Esc)')").count() == 0, "card still says Close (Esc) in the game")
        pg.locator("[data-vtg-market-detail] button:has-text('Close')").last.dispatch_event("click")
        pg.evaluate("() => window.__vtGame.engine.screens.undock()")
        game_steps(pg, 30)
    with s.step("game: an app modal is shown on the Comms display, not in screen space"):
        pg.evaluate("() => window.__vtGame.openTestModal()")
        # Mantine's open transition needs a few composited frames, which are slow under software GL
        pg.wait_for_selector(".mantine-Modal-content", state="attached", timeout=30000)
        game_steps(pg, 30)
        s.check(V(pg, "g.modals.isOpen") is True, "router did not take the modal")
        s.check(pg.evaluate("() => !!document.querySelector('[data-screen=comms] .mantine-Modal-content')"), "modal not inside the comms screen")
        s.check(V(pg, "g.engine.screens.docked && g.engine.screens.docked.id") == "comms", "comms not docked")
        pg.locator(".mantine-Modal-content button:has-text('Cancel')").dispatch_event("click")
        pg.wait_for_selector(".mantine-Modal-content", state="detached", timeout=10000)
        game_steps(pg, 30)
        s.check(V(pg, "g.modals.isOpen") is False and not V(pg, "g.engine.screens.busy"), "comms did not close")
        s.check(pg.evaluate("() => document.querySelector('[data-mantine-shared-portal-node]').parentElement === document.body"), "portal node not back in <body>")
    with s.step("game: third person in the observatory"):
        pg.evaluate("() => window.__vtGame.engine.setView('third')")
        game_steps(pg, 30)
        pg.evaluate("() => window.__vtGame.engine.setView('first')")
    with s.step("game: leaving for the classic view (key chord) unmounts the game at once"):
        pg.keyboard.press("Control+Shift+F12")
        pg.wait_for_selector("[data-vtg-host]", state="detached", timeout=10000)
        pg.wait_for_selector("nav button", timeout=20000)
        s.check(pg.evaluate("() => !document.querySelector('.vtg-root') && !window.__vtGame"), "game DOM or handle left behind")
        s.check(pg.evaluate("() => { const n = document.querySelector('[data-mantine-shared-portal-node]'); return !n || document.body.contains(n); }"), "portal node lost")


SCENARIOS = {
    "boot": lambda s: scenario_boot(s),
    "classic": lambda s: scenario_classic(s),
    "offline": lambda s: scenario_classic_offline(s),
    "station": lambda s: scenario_station(s, fp=False),
    "fp": lambda s: scenario_station(s, fp=True),
    "remount": lambda s: scenario_remount(s),
    "safety": lambda s: scenario_safety(s),
    "layout": lambda s: scenario_layout(s, DEFAULT_WINDOW[0], DEFAULT_WINDOW[1]),
    "small": lambda s: scenario_layout(s, 1280, 800, classic=False, alerts=False),
    "game": lambda s: scenario_game(s),
    "shell": lambda s: scenarios_shell.scenario_shell(s, sys.modules[__name__]),
    "audio": lambda s: scenario_audio(s),
}


def default_window() -> tuple[int, int]:
    conf = json.loads((ROOT / "src-tauri" / "tauri.conf.json").read_text())
    win = conf["app"]["windows"][0]
    return int(win["width"]), int(win["height"])


DEFAULT_WINDOW = default_window()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append", help="scenario(s) to run: " + ", ".join(list(SCENARIOS) + ["dist"]))
    ap.add_argument("--shots", default=str(DEFAULT_SHOTS))
    ap.add_argument("--skip-build", action="store_true", help="dist scenario: use the existing dist/ instead of building")
    ap.add_argument("--report", default=str(HERE / "last-report.json"))
    args = ap.parse_args()
    wanted = args.only or list(SCENARIOS) + ["dist"]
    shots = Path(args.shots)

    subprocess.run(["node", str(HERE / "gen-contract.mjs")], check=True)
    reports = []
    t0 = time.time()

    dev = [x for x in wanted if x in SCENARIOS]
    if dev:
        server = Server("dev")
        try:
            suite = Suite(shots, server, "dev")
            suite.default_storage = CLASSIC
            for name in dev:
                print(f"--- scenario {name}", flush=True)
                try:
                    SCENARIOS[name](suite)
                except Exception as e:  # noqa: BLE001
                    with suite.step(f"{name}: scenario aborted"):
                        raise e
            reports.append(suite.finish())
        finally:
            server.stop()

    if "dist" in wanted:
        if not args.skip_build:
            print("--- building dist/ (pnpm build)", flush=True)
            subprocess.run(["pnpm", "build"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        server = Server("dist")
        try:
            suite = Suite(shots, server, "dist")
            suite.default_storage = CLASSIC
            print("--- scenario dist", flush=True)
            try:
                scenario_dist(suite)
            except Exception as e:  # noqa: BLE001
                with suite.step("dist: scenario aborted"):
                    raise e
            reports.append(suite.finish())
        finally:
            server.stop()

    # ---- summary
    total = sum(r["steps"] for r in reports)
    passed = sum(r["passed"] for r in reports)
    failed = [f for r in reports for f in r["failed"]]
    merged = {k: sorted({x for r in reports for x in r[k]}) for k in ("unknown", "notRegistered", "contractErrors", "extraArgs", "denied")}
    commands = sorted({c for r in reports for c in r["commands"] if not c.startswith("plugin:")})
    contract = json.loads((HERE / "contract.json").read_text())
    never = sorted(set(contract) - set(commands))
    print("\n================ HARNESS SUMMARY ================")
    print(f"steps: {total}   passed: {passed}   failed: {len(failed)}   time: {time.time() - t0:.0f}s")
    for f in failed:
        print(f"  FAIL {f['n']} {f['name']}")
        for d in f["detail"][:6]:
            print(f"       {d[:400]}")
    print(f"unknown commands (no mock handler): {len(merged['unknown'])} {merged['unknown']}")
    print(f"commands not registered in Rust: {len(merged['notRegistered'])} {merged['notRegistered']}")
    print(f"contract violations (missing/wrong arguments): {len(merged['contractErrors'])} {merged['contractErrors']}")
    print(f"plugin calls denied by capabilities: {len(merged['denied'])} {merged['denied']}")
    print(f"arguments sent that Rust does not take (ignored by Tauri): {merged['extraArgs']}")
    print(f"backend commands exercised: {len(commands)} of {len(contract)} registered; never called: {never}")
    print(f"ignored console noise: { {k: v for r in reports for k, v in r['ignored'].items()} }")
    print(f"external hosts blocked (images stubbed): { {k: v for r in reports for k, v in r['external_hosts_blocked'].items()} }")
    print(f"screenshots: {shots}")
    Path(args.report).write_text(json.dumps({"reports": reports, "summary": {"steps": total, "passed": passed, "failed": len(failed), **merged, "never_called": never}}, indent=1))
    clean = not failed and not merged["unknown"] and not merged["notRegistered"] and not merged["contractErrors"]
    print("RESULT:", "CLEAN" if clean else "NOT CLEAN")
    return 0 if clean else 1


if __name__ == "__main__":
    sys.exit(main())
