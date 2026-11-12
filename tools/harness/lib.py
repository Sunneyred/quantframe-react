"""Shared plumbing for the Void Trader browser harness (see README.md)."""

from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import sys
import time
import traceback
from contextlib import contextmanager
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CHROME_ARGS = ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

# Console noise that says nothing about the app. Everything else fails the step it happens in.
IGNORED = [
    (re.compile(r"favicon\.ico"), "favicon request"),
    (re.compile(r"Download the React DevTools"), "React DevTools hint"),
    (re.compile(r"\[vite\]"), "Vite dev-server client messages"),
    (re.compile(r"GPU stall due to ReadPixels|Automatic fallback to software WebGL|GroupMarkerNotSet"), "software WebGL driver messages from headless Chromium"),
    (re.compile(r"ERR_ABORTED.*\.(mp3|ogg|wav)|play\(\) (failed|request)|NotSupportedError: (Failed to load because no supported source|The element has no supported sources)"), "audio playback in headless Chromium (the mock serves no sound files)"),
]


def find_chrome() -> str | None:
    for path in (os.environ.get("HARNESS_CHROME"), "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"):
        if path and os.path.exists(path):
            return path
    return None  # let Playwright use its own Chromium


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def wait_port(port: int, timeout: float = 90) -> None:
    end = time.time() + timeout
    while time.time() < end:
        try:
            socket.create_connection(("127.0.0.1", port), timeout=1).close()
            return
        except OSError:
            time.sleep(0.3)
    raise RuntimeError(f"server on port {port} did not start")


class Server:
    """The Vite dev server (real src/main.tsx) or `vite preview` of dist/ (the production bundle)."""

    def __init__(self, mode: str):
        self.mode = mode
        self.proc = None
        reuse = os.environ.get("HARNESS_DEV_URL") if mode == "dev" else None
        if reuse:  # an already running Vite dev server (handy while writing tests)
            self.url = reuse.rstrip("/")
            return
        self.port = free_port()
        cmd = ["node", str(ROOT / "node_modules" / "vite" / "bin" / "vite.js")]
        if mode == "dist":
            cmd += ["preview", "--port", str(self.port), "--strictPort", "--host", "127.0.0.1"]
        else:
            cmd += ["--port", str(self.port), "--strictPort", "--host", "127.0.0.1"]
        self.log = open(HERE / f".server-{mode}.log", "w")
        self.proc = subprocess.Popen(cmd, cwd=ROOT, stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)
        wait_port(self.port)
        self.url = f"http://127.0.0.1:{self.port}"

    def stop(self) -> None:
        if self.proc is None:
            return
        try:
            os.killpg(self.proc.pid, 15)
        except ProcessLookupError:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            os.killpg(self.proc.pid, 9)
        self.log.close()


def capabilities() -> list[str]:
    """Every permission identifier granted to the main window in src-tauri/capabilities."""
    out: list[str] = []
    for f in sorted((ROOT / "src-tauri" / "capabilities").glob("*.json")):
        cap = json.loads(f.read_text())
        if "main" not in cap.get("windows", ["main"]):
            continue
        for p in cap.get("permissions", []):
            out.append(p if isinstance(p, str) else p.get("identifier", ""))
    return out


def mock_script(options: dict) -> str:
    contract = (HERE / "contract.json").read_text()
    src = (HERE / "mock" / "tauri-mock.js").read_text()
    opts = dict(options)
    opts["permissions"] = capabilities()
    tos = ROOT / "src-tauri" / "resources" / "tos.md"
    if tos.is_file():
        opts["tosText"] = tos.read_text(encoding="utf-8")
    return src.replace("__CONTRACT__", contract, 1).replace("__OPTIONS__", json.dumps(opts), 1)


PNG_1X1 = bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c626001000000ffff03000006000557bfabd40000000049454e44ae426082")


class Suite:
    def __init__(self, shots: Path, server: Server, label: str):
        self.shots = shots
        self.server = server
        self.label = label
        self.results: list[dict] = []
        self.ignored: dict[str, int] = {}
        self.external: dict[str, int] = {}
        self.pw = sync_playwright().start()
        self.browser = self.pw.chromium.launch(executable_path=find_chrome(), args=CHROME_ARGS)
        self.page: Page | None = None
        self.errors: list[str] = []
        self.counter = 0
        self.session_reports: list[dict] = []
        shots.mkdir(parents=True, exist_ok=True)

    # --- sessions -------------------------------------------------------------------------
    def open(self, width: int, height: int, options: dict | None = None, storage: dict | None = None, path: str = "/") -> Page:
        """A fresh app session: new browser context, mock backend injected before any app code."""
        self.close_session()
        ctx = self.browser.new_context(viewport={"width": width, "height": height}, device_scale_factor=1)
        ctx.grant_permissions(["clipboard-read", "clipboard-write"])
        ctx.add_init_script(mock_script(options or {}))
        if storage:
            ctx.add_init_script("(() => { const s = %s; for (const k in s) { if (localStorage.getItem('__harness_seeded_' + k) === null) { localStorage.setItem(k, s[k]); localStorage.setItem('__harness_seeded_' + k, '1'); } } })();" % json.dumps(storage))

        def route(r):
            url = r.request.url
            if url.startswith(self.server.url) or url.startswith("data:") or url.startswith("blob:"):
                return r.continue_()
            host = re.sub(r"^[a-z]+://([^/]+)/.*$", r"\1", url)
            if host == "asset.localhost":
                # the asset protocol (convertFileSrc): serve the app's real bundled resources
                from urllib.parse import unquote

                wanted = unquote(url.split("asset.localhost/", 1)[1]).replace("\\", "/")
                marker = "Void Trader/resources/"
                if marker in wanted:
                    f = ROOT / "src-tauri" / "resources" / wanted.split(marker, 1)[1]
                    if f.is_file():
                        kind = {"mp3": "audio/mpeg", "ogg": "audio/ogg", "wav": "audio/wav", "md": "text/markdown", "json": "application/json"}.get(f.suffix[1:], "application/octet-stream")
                        return r.fulfill(status=200, content_type=kind, body=f.read_bytes())
                self._error(f"asset not found in src-tauri/resources: {wanted}")
                return r.fulfill(status=404, body=b"")
            self.external[host] = self.external.get(host, 0) + 1
            if r.request.resource_type == "image":
                return r.fulfill(status=200, content_type="image/png", body=PNG_1X1)
            return r.abort()

        ctx.route("**/*", route)
        page = ctx.new_page()
        page.set_default_timeout(10000)
        page.on("pageerror", lambda e: self._error(f"pageerror: {e}"))
        page.on("console", self._console)
        page.on("requestfailed", lambda r: self._error(f"requestfailed: {r.url} {r.failure}") if r.url.startswith(self.server.url) and "ERR_ABORTED" not in str(r.failure) else None)
        page.on("response", lambda r: self._error(f"http {r.status}: {r.url}") if r.status >= 400 and r.url.startswith(self.server.url) else None)
        self.page = page
        page.goto(self.server.url + path)
        return page

    def close_session(self) -> None:
        if self.page is None:
            return
        try:
            report = self.page.evaluate("() => { const h = window.__HARNESS__; return h ? { unknown: h.unknown, notRegistered: h.notRegistered, contractErrors: h.contractErrors, extraArgs: h.extraArgs, denied: h.denied, counts: h.counts } : null; }")
            if report:
                self.session_reports.append(report)
        except Exception:
            pass
        self.page.context.close()
        self.page = None

    # --- error capture --------------------------------------------------------------------
    def _console(self, msg) -> None:
        if msg.type != "error":
            return
        text = msg.text
        try:
            # console.error("%c...", style, obj): show the objects too
            extra = []
            for a in msg.args[1:]:
                try:
                    extra.append(json.dumps(a.json_value(), default=str)[:400])
                except Exception:
                    pass
            if extra:
                text += " | " + " ".join(extra)
        except Exception:
            pass
        self._error(f"console.error: {text}")

    def _error(self, text: str) -> None:
        for pattern, why in IGNORED:
            if pattern.search(text):
                self.ignored[why] = self.ignored.get(why, 0) + 1
                return
        self.errors.append(text)

    # --- steps ----------------------------------------------------------------------------
    @contextmanager
    def step(self, name: str, allow: list[str] | None = None, shot: bool = True, settle: float = 0.35):
        """One test step. Fails on an exception, a failed check, or any console/page error that
        is not matched by `allow` (regexes for errors this step provokes on purpose)."""
        self.counter += 1
        num = f"{self.counter:03d}"
        self.errors = []
        checks: list[str] = []
        self._checks = checks
        status = "pass"
        detail: list[str] = []
        t0 = time.time()
        try:
            yield
            if self.page:
                self.page.wait_for_timeout(int(settle * 1000))
        except Exception as e:  # noqa: BLE001
            status = "fail"
            detail.append("exception: " + "".join(traceback.format_exception_only(type(e), e)).strip()[:1500])
        allowed = [re.compile(a) for a in (allow or [])]
        unexpected = [e for e in self.errors if not any(a.search(e) for a in allowed)]
        expected = [e for e in self.errors if any(a.search(e) for a in allowed)]
        if unexpected:
            status = "fail"
            detail += ["error: " + e[:1200] for e in unexpected[:12]]
        if checks:
            status = "fail"
            detail += ["check: " + c for c in checks]
        file = None
        if shot and self.page:
            file = f"{self.label}-{num}-{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')[:70]}.png"
            try:
                self.page.screenshot(path=str(self.shots / file))
            except Exception as e:  # noqa: BLE001
                detail.append(f"screenshot failed: {e}")
        self.results.append({"n": num, "name": name, "status": status, "detail": detail, "shot": file, "expected_errors": len(expected), "seconds": round(time.time() - t0, 1)})
        mark = "ok  " if status == "pass" else "FAIL"
        print(f"[{self.label}] {num} {mark} {name}" + ("" if status == "pass" else "\n        " + "\n        ".join(detail)), flush=True)

    def check(self, condition, message: str) -> bool:
        if not condition:
            self._checks.append(message)
        return bool(condition)

    # --- reporting ------------------------------------------------------------------------
    def finish(self) -> dict:
        self.close_session()
        self.browser.close()
        self.pw.stop()
        merged = {"unknown": [], "notRegistered": [], "contractErrors": [], "extraArgs": [], "denied": [], "commands": {}}
        for r in self.session_reports:
            for k in ("unknown", "notRegistered", "contractErrors", "denied"):
                for item in r[k]:
                    key = item if isinstance(item, str) else f"{item['cmd']}: {item['error']}"
                    if key not in merged[k]:
                        merged[k].append(key)
            for item in r["extraArgs"]:
                if item not in merged["extraArgs"]:
                    merged["extraArgs"].append(item)
            for cmd, n in r["counts"].items():
                merged["commands"][cmd] = merged["commands"].get(cmd, 0) + n
        return {
            "label": self.label,
            "steps": len(self.results),
            "passed": sum(1 for r in self.results if r["status"] == "pass"),
            "failed": [r for r in self.results if r["status"] != "pass"],
            "results": self.results,
            "ignored": self.ignored,
            "external_hosts_blocked": self.external,
            **merged,
        }


def eprint(*a) -> None:
    print(*a, file=sys.stderr, flush=True)
