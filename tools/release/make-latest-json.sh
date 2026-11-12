#!/usr/bin/env bash
# Void Trader: write latest.json for the in-app updater.
# Usage: tools/release/make-latest-json.sh <version> <path-to-setup.exe> <path-to-private-key>
# The installer is signed locally; latest.json (committed at the repo root on the void-trader
# branch) points the app at the GitHub release asset. The private key is never committed.
set -euo pipefail
VERSION="$1"; EXE="$2"; KEY="$3"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
npx --prefix "$ROOT" tauri signer sign -f "$KEY" -p "" "$EXE" >/dev/null
SIG="$(cat "$EXE.sig")"
python3 - "$VERSION" "$SIG" "$ROOT/latest.json" <<'PY'
import json, sys, datetime
version, sig, out = sys.argv[1:4]
url = f"https://github.com/Sunneyred/quantframe-react/releases/download/v{version}/Void.Trader_{version}_x64-setup.exe"
json.dump({
    "version": version,
    "notes": f"Void Trader {version}",
    "pub_date": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "platforms": {"windows-x86_64": {"signature": sig, "url": url}},
}, open(out, "w"), indent=2)
open(out, "a").write("\n")
print("wrote", out)
PY
