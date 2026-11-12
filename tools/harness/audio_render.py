#!/usr/bin/env python3
"""Offline render check of the game's synthesised sound (src/game/audio).

Nobody can listen in CI, so this renders every tape, every one-shot, both room tones and the market
texture through the real bus graph in an OfflineAudioContext (headless Chromium, the module is
src/game/audio/render.ts served by the Vite dev server), measures them and fails on:

  - any clipped sample, or a peak above -1 dBFS after the limiter
  - a DC offset
  - music that is too loud, too quiet, uneven between tapes, or bright above 8 kHz
  - an alert that does not stand clearly above the music, room tone that is not below it
  - a master chain whose small-signal gain is not unity
  - a tape whose composition repeats

It also writes WAVs (30 s of each tape, each sound) and spectrogram PNGs to --out
(default /tmp/stage1c-audio). LOOK at the PNGs: numbers do not show a wrong envelope.

    python3 tools/harness/audio_render.py [--out DIR] [--seconds 64]
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import wave
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parent))
from lib import CHROME_ARGS, Server, find_chrome  # noqa: E402

BLANK = "<!doctype html><html><head><meta charset='utf-8'><title>audio render</title></head><body></body></html>"
CALL = "async ([fn, args]) => { const m = await import('/src/game/audio/render.ts'); return await m[fn](...args); }"


def db(x: float) -> float:
    return 20 * np.log10(max(float(x), 1e-12))


def decode(r: dict) -> tuple[np.ndarray, int]:
    a = np.frombuffer(base64.b64decode(r["data"]), dtype="<f4").reshape(-1, 2)
    return a, int(r["sampleRate"])


def spectrum(mono: np.ndarray, sr: int) -> tuple[np.ndarray, np.ndarray]:
    """Average power spectrum (Welch, Hann, 4096)."""
    n = 4096
    if len(mono) < n:
        mono = np.pad(mono, (0, n - len(mono)))
    hop = n // 2
    win = np.hanning(n)
    acc = np.zeros(n // 2 + 1)
    count = 0
    for i in range(0, len(mono) - n + 1, hop):
        acc += np.abs(np.fft.rfft(mono[i : i + n] * win)) ** 2
        count += 1
    return np.fft.rfftfreq(n, 1 / sr), acc / max(count, 1)


def analyse(a: np.ndarray, sr: int) -> dict:
    mono = a.mean(axis=1)
    peak = float(np.abs(a).max())
    rms = float(np.sqrt((a**2).mean()))
    # "active" loudness: 100 ms blocks within 30 dB of the loudest block
    blk = sr // 10
    nb = max(1, len(mono) // blk)
    e = np.array([float((a[i * blk : (i + 1) * blk] ** 2).mean()) for i in range(nb)])
    active = e[e > e.max() * 1e-3] if e.max() > 0 else e
    f, p = spectrum(mono, sr)
    total = p.sum() or 1e-30
    return {
        "seconds": round(len(a) / sr, 2),
        "peak_db": round(db(peak), 2),
        "rms_db": round(db(rms), 2),
        "active_rms_db": round(db(np.sqrt(active.mean())) if len(active) else -120.0, 2),
        "loudest_100ms_db": round(db(np.sqrt(e.max())), 2),
        "dc": round(float(np.abs(a.mean(axis=0)).max()), 6),
        "clipped": int((np.abs(a) >= 0.999).sum()),
        "centroid_hz": round(float((f * p).sum() / total), 1),
        "above_8k_db": round(10 * np.log10(max(p[f >= 8000].sum() / total, 1e-30)), 1),
        "below_40_db": round(10 * np.log10(max(p[f < 40].sum() / total, 1e-30)), 1),
        "stereo_corr": round(float(np.corrcoef(a[:, 0], a[:, 1])[0, 1]) if a[:, 0].std() > 0 and a[:, 1].std() > 0 else 1.0, 3),
    }


def write_wav(path: Path, a: np.ndarray, sr: int, seconds: float | None = None) -> None:
    if seconds:
        a = a[: int(seconds * sr)]
    pcm = (np.clip(a, -1, 1) * 32767).astype("<i2")
    with wave.open(str(path), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def plot(path: Path, items: list[tuple[str, np.ndarray, int]], cols: int = 1, fmax: int = 12000, title: str = "") -> None:
    """Per item: the level envelope (dBFS, 20 ms blocks) above a spectrogram (dB, up to fmax)."""
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rows = (len(items) + cols - 1) // cols
    fig, axes = plt.subplots(rows * 2, cols, figsize=(7.2 * cols, 3.0 * rows), squeeze=False, gridspec_kw={"height_ratios": [1, 2.4] * rows})
    for ax in axes.flat:
        ax.axis("off")
    for i, (name, a, sr) in enumerate(items):
        r, c = divmod(i, cols)
        mono = a.mean(axis=1)
        top, bot = axes[r * 2][c], axes[r * 2 + 1][c]
        top.axis("on")
        bot.axis("on")
        blk = max(1, sr // 50)
        nb = max(1, len(mono) // blk)
        env = np.array([np.sqrt((mono[k * blk : (k + 1) * blk] ** 2).mean() + 1e-12) for k in range(nb)])
        pk = np.array([np.abs(a[k * blk : (k + 1) * blk]).max() + 1e-6 for k in range(nb)])
        tt = np.arange(nb) * blk / sr
        top.plot(tt, 20 * np.log10(pk), color="#c9a13a", lw=0.6, label="peak")
        top.plot(tt, 20 * np.log10(env), color="#1b7f8c", lw=0.8, label="rms")
        top.axhline(-1, color="red", lw=0.5, ls="--")
        top.set_ylim(-72, 0)
        top.set_xlim(0, len(mono) / sr)
        top.set_title(name, fontsize=9, loc="left")
        top.tick_params(labelsize=6, labelbottom=False)
        top.grid(alpha=0.25)
        nfft = 2048 if len(mono) > sr * 3 else 1024
        if len(mono) < nfft * 2:
            mono = np.pad(mono, (0, nfft * 2 - len(mono)))
        bot.specgram(mono, NFFT=nfft, Fs=sr, noverlap=nfft * 3 // 4, cmap="magma", vmin=-150, vmax=-40)
        bot.set_ylim(0, fmax)
        bot.axhline(8000, color="white", lw=0.4, ls=":")
        bot.tick_params(labelsize=6)
        bot.set_ylabel("Hz", fontsize=6)
    if title:
        fig.suptitle(title, fontsize=10)
    fig.tight_layout()
    fig.savefig(path, dpi=90)
    plt.close(fig)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/stage1c-audio")
    ap.add_argument("--seconds", type=float, default=64.0, help="length of each tape render")
    ap.add_argument("--no-plots", action="store_true", help="numbers only (quick, while tuning)")
    args = ap.parse_args()
    if args.no_plots:
        globals()["plot"] = lambda *a, **k: None
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    report: dict = {"tapes": {}, "sounds": {}, "ambience": {}, "texture": {}}

    def check(ok: bool, msg: str) -> None:
        if not ok:
            failures.append(msg)
            print("  FAIL", msg, flush=True)

    def common(name: str, m: dict) -> None:
        check(m["clipped"] == 0, f"{name}: {m['clipped']} clipped samples")
        check(m["peak_db"] <= -1.0, f"{name}: peak {m['peak_db']} dBFS is above -1 dBFS")
        check(m["dc"] < 0.002, f"{name}: DC offset {m['dc']}")

    server = Server("dev")
    pw = sync_playwright().start()
    browser = pw.chromium.launch(executable_path=find_chrome(), args=CHROME_ARGS)
    try:
        page = browser.new_page()
        page.set_default_timeout(300000)
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/__audio_render__", lambda r: r.fulfill(status=200, content_type="text/html", body=BLANK))
        page.goto(server.url + "/__audio_render__")

        def call(fn: str, *a):
            return page.evaluate(CALL, [fn, list(a)])

        gain = call("masterChainGain")
        report["master_chain_gain_db"] = round(db(gain), 2)
        print(f"master chain small-signal gain: {db(gain):+.2f} dB", flush=True)
        check(abs(db(gain)) <= 0.5, f"master chain gain is {db(gain):+.2f} dB, not unity (retune LIMITER.trim in graph.ts: multiply it by {1 / gain:.3f})")

        tapes = call("tapeIds")
        sheet = []
        for tid in tapes:
            a, sr = decode(call("renderTape", tid, args.seconds))
            m = analyse(a[sr * 4 :], sr)  # after the fade-in and the first pad attack
            # how even it is: loudness of 4 s windows
            win = sr * 4
            lv = [db(np.sqrt((a[i : i + win] ** 2).mean())) for i in range(sr * 4, len(a) - win, win)]
            m["window_min_db"], m["window_max_db"] = round(min(lv), 1), round(max(lv), 1)
            report["tapes"][tid] = m
            print(f"tape {tid:16s} rms {m['rms_db']:6.1f}  peak {m['peak_db']:6.1f}  4s-windows {m['window_min_db']:6.1f}..{m['window_max_db']:6.1f}  centroid {m['centroid_hz']:6.0f} Hz  >8k {m['above_8k_db']:6.1f} dB  dc {m['dc']:.5f}  clip {m['clipped']}  L/R corr {m['stereo_corr']}", flush=True)
            common(f"tape {tid}", m)
            check(-34 <= m["rms_db"] <= -22, f"tape {tid}: RMS {m['rms_db']} dBFS outside -34..-22 at the default dials")
            check(m["above_8k_db"] <= -40, f"tape {tid}: energy above 8 kHz is {m['above_8k_db']} dB of the total (limit -40)")
            check(m["centroid_hz"] <= 1800, f"tape {tid}: spectral centroid {m['centroid_hz']} Hz (harsh)")
            check(m["window_max_db"] - m["window_min_db"] <= 14, f"tape {tid}: level swings {m['window_max_db'] - m['window_min_db']:.1f} dB between 4 s windows")
            check(m["window_min_db"] >= -48, f"tape {tid}: a 4 s window is nearly silent ({m['window_min_db']} dBFS)")
            write_wav(out / f"tape-{tid}.wav", a, sr, 30)
            plot(out / f"tape-{tid}.png", [(f"tape {tid} ({args.seconds:.0f} s, default dials)", a, sr)])
            sheet.append((tid, a[: sr * 30], sr))
            bars = call("composeSummary", tid, 256)
            rep = max((sum(1 for i in range(len(bars) - 2 * k) if bars[i : i + k] == bars[i + k : i + 2 * k]) for k in (1, 2, 4, 8, 16)), default=0)
            windows = {tuple(bars[i : i + 4]) for i in range(len(bars) - 3)}
            busy = [tuple(bars[i : i + 4]) for i in range(len(bars) - 3) if all(b.split("|")[1] for b in bars[i : i + 4])]
            m["distinct_bars_of_256"] = len(set(bars))
            m["repeated_4bar_phrases"] = len(busy) - len(set(busy))
            print(f"     composition: {len(set(bars))}/256 distinct bars, {len(windows)} distinct 4-bar windows, {m['repeated_4bar_phrases']} repeated 4-bar phrases with notes, {rep} immediate repeats", flush=True)
            check(len(set(bars)) >= 140 and len(windows) >= 250, f"tape {tid}: only {len(set(bars))} distinct bars and {len(windows)} distinct 4-bar windows in 256 bars")
            check(m["repeated_4bar_phrases"] == 0, f"tape {tid}: {m['repeated_4bar_phrases']} four-bar phrases repeat")
        plot(out / "sheet-tapes.png", sheet, cols=1, title="tapes, first 30 s")
        rmss = [report["tapes"][t]["rms_db"] for t in tapes]
        check(max(rmss) - min(rmss) <= 3.0, f"tapes differ by {max(rmss) - min(rmss):.1f} dB in loudness (set TapeDef.level)")
        music = float(np.mean(rmss))
        report["music_mean_rms_db"] = round(music, 2)

        variants = {
            "footstep": [("stone", {"surface": "stone", "foot": "L", "seed": 1}), ("metal", {"surface": "metal", "foot": "R", "seed": 2}), ("hollow", {"surface": "hollow", "foot": "L", "seed": 3})],
            "chime": [("low-dull", {"pitch": 440, "brightness": 0.1}), ("mid", {"pitch": 880, "brightness": 0.5}), ("high-bright", {"pitch": 1760, "brightness": 1})],
            "announce": [("cyan", {"tone": "cyan"}), ("red", {"tone": "red"})],
            "robot-beep": [("ok", {"mood": "ok", "seed": 4}), ("query", {"mood": "query", "seed": 5}), ("sad", {"mood": "sad", "seed": 6})],
            "sale": [("25p", {"amount": 25, "seed": 1}), ("900p", {"amount": 900, "seed": 2})],
        }
        sheet = []
        for name in call("soundNames"):
            for tag, opts in variants.get(name, [("", {})]):
                label = f"{name}-{tag}" if tag else name
                a, sr = decode(call("renderSound", name, opts))
                m = analyse(a, sr)
                report["sounds"][label] = m
                print(f"sound {label:22s} {m['seconds']:5.2f} s  peak {m['peak_db']:6.1f}  loudest100ms {m['loudest_100ms_db']:6.1f}  active rms {m['active_rms_db']:6.1f}  centroid {m['centroid_hz']:6.0f} Hz  dc {m['dc']:.5f}  clip {m['clipped']}", flush=True)
                common(f"sound {label}", m)
                check(m["peak_db"] >= -45, f"sound {label}: inaudible (peak {m['peak_db']} dBFS)")
                tail = a[-sr // 20 :]
                check(float(np.abs(tail).max()) < 0.003, f"sound {label}: does not end in silence (cut off or droning)")
                write_wav(out / f"sfx-{label}.wav", a, sr)
                sheet.append((label, a, sr))
        for i in range(0, len(sheet), 9):
            plot(out / f"sheet-sfx-{i // 9 + 1}.png", sheet[i : i + 9], cols=3)
        s = report["sounds"]
        check(s["alert"]["loudest_100ms_db"] >= music + 8, f"alert ({s['alert']['loudest_100ms_db']} dBFS) is not 8 dB above the music ({music:.1f} dBFS)")
        check(s["sale-25p"]["loudest_100ms_db"] >= music + 4, f"sale ({s['sale-25p']['loudest_100ms_db']} dBFS) does not stand above the music ({music:.1f} dBFS)")
        check(s["alert"]["loudest_100ms_db"] >= s["footstep-stone"]["loudest_100ms_db"] + 6, "alert is not clearly above a footstep")
        check(s["hover"]["peak_db"] <= s["click"]["peak_db"] - 3, "hover tick is not quieter than a click")
        check(s["chime-high-bright"]["centroid_hz"] > s["chime-low-dull"]["centroid_hz"] * 1.8, "chime brightness/pitch does not move the spectrum")

        sheet = []
        for room in ("vault", "observatory"):
            a, sr = decode(call("renderAmbience", room, 30))
            m = analyse(a[sr * 2 :], sr)
            report["ambience"][room] = m
            print(f"ambience {room:12s} rms {m['rms_db']:6.1f}  peak {m['peak_db']:6.1f}  centroid {m['centroid_hz']:6.0f} Hz  dc {m['dc']:.5f}", flush=True)
            common(f"ambience {room}", m)
            check(m["rms_db"] <= music - 6, f"ambience {room}: {m['rms_db']} dBFS is not 6 dB under the music ({music:.1f})")
            check(m["rms_db"] >= -60, f"ambience {room}: inaudible ({m['rms_db']} dBFS)")
            write_wav(out / f"ambience-{room}.wav", a, sr)
            sheet.append((f"ambience {room}", a, sr))
        amb = report["ambience"]
        check(abs(amb["vault"]["centroid_hz"] - amb["observatory"]["centroid_hz"]) / max(amb["vault"]["centroid_hz"], 1) > 0.15, "the two room tones have the same spectral centroid")
        for dens in (0.12, 0.5, 1.0):
            a, sr = decode(call("renderTexture", dens, 20))
            m = analyse(a[sr:], sr)
            report["texture"][str(dens)] = m
            print(f"texture density {dens:4.2f}  rms {m['rms_db']:6.1f}  peak {m['peak_db']:6.1f}  centroid {m['centroid_hz']:6.0f} Hz", flush=True)
            common(f"texture {dens}", m)
            write_wav(out / f"texture-{dens}.wav", a, sr)
            sheet.append((f"market texture, density {dens}", a, sr))
        tx = report["texture"]
        check(tx["1.0"]["rms_db"] > tx["0.12"]["rms_db"] + 6, "market texture density does not change its level")
        check(tx["0.12"]["rms_db"] <= music - 8, f"market texture at its default density ({tx['0.12']['rms_db']} dBFS) is not well under the music")
        check(tx["1.0"]["rms_db"] <= music + 3, f"market texture at full density ({tx['1.0']['rms_db']} dBFS) is louder than the music")
        plot(out / "sheet-ambience.png", sheet, cols=1)

        a, sr = decode(call("renderWorstCase", 24))
        m = analyse(a, sr)
        report["worst_case"] = m
        print(f"worst case (all dials up, everything at once)  peak {m['peak_db']:6.1f}  rms {m['rms_db']:6.1f}  clip {m['clipped']}", flush=True)
        common("worst case", m)
        write_wav(out / "worst-case.wav", a, sr)
        plot(out / "worst-case.png", [("worst case: both dials at 100 %, every layer and a burst of one-shots every 2.5 s", a, sr)])
        check(not errors, f"page errors: {errors}")
    finally:
        browser.close()
        pw.stop()
        server.stop()

    report["failures"] = failures
    (out / "report.json").write_text(json.dumps(report, indent=1))
    print(f"\n{'FAILED: ' + str(len(failures)) + ' check(s)' if failures else 'all audio render checks passed'}; files in {out}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
