#!/usr/bin/env python3
"""Local mirror of the token-radar-01 gate's seven checks, run against an output dir.
Usage: python3 gate-check.py <outdir> [snapshot.json]
Prints PASS/FAIL per check and exits 1 on any failure. Does not replace the server gate.
"""
import json
import os
import re
import sys
from PIL import Image

outdir = sys.argv[1]
snap_path = sys.argv[2] if len(sys.argv) > 2 else "/home/hatch/workspace/makefun/token-radar-01-kit/input/snapshot.json"
fails = []


def check(name, ok, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")
    if not ok:
        fails.append(name)


snap = json.load(open(snap_path))
proto_slugs = {p["slug"] for p in snap["protocols"]}
watchlist = snap["watchlist"]

# 1. dashboard_files
dash = os.path.join(outdir, "dashboard")
files = []
for root, _, names in os.walk(dash):
    for n in names:
        files.append(os.path.join(root, n))
total = sum(os.path.getsize(f) for f in files)
names = [os.path.basename(f) for f in files]
has_html = any(n == "index.html" for n in names)
has_css = any(n.endswith(".css") for n in names)
has_js = any(n.endswith(".js") for n in names)
url_hits = []
for f in files:
    if f.endswith((".html", ".css", ".js")):
        text = open(f, errors="ignore").read()
        for m in re.finditer(r"https?://[^\s\"'<>]+", text):
            url_hits.append(f"{os.path.basename(f)}: {m.group(0)[:60]}")
check("dashboard_files", has_html and has_css and has_js and len(files) <= 400 and total <= 4 * 1024 * 1024 and not url_hits,
      f"files={len(files)} bytes={total} html={has_html} css={has_css} js={has_js} urls={url_hits[:3]}")

# 2/3/4/5. board
board = json.load(open(os.path.join(outdir, "board.json")))
rows = board["rows"] if isinstance(board, dict) else board
ok_board = 100 <= len(rows) <= 4000 and os.path.getsize(os.path.join(outdir, "board.json")) <= 8 * 1024 * 1024
bad = []
for r in rows:
    if r["slug"] not in proto_slugs:
        bad.append(f"unknown slug {r['slug']}")
    if not r.get("name"):
        bad.append(f"empty name {r['slug']}")
    if not isinstance(r.get("rank"), int) or r["rank"] < 1:
        bad.append(f"bad rank {r['slug']}")
    iv = r.get("implied_value_usd")
    if not isinstance(iv, int) or iv <= 0 or iv > 100_000_000_000_000:
        bad.append(f"bad implied {r['slug']}")
    steps = r.get("farm_steps", [])
    if not (3 <= len(steps) <= 12):
        bad.append(f"steps {len(steps)} {r['slug']}")
    for s in steps:
        if not (20 <= len(s.strip()) <= 600):
            bad.append(f"step len {len(s)} {r['slug']}")
ok_board = ok_board and not bad
check("board_file", ok_board, f"rows={len(rows)} bad={bad[:3]}")
ranks = sorted(r["rank"] for r in rows)
mono = all(rows[i]["implied_value_usd"] >= rows[i + 1]["implied_value_usd"] for i in range(len(rows) - 1))
allsame = len({r["implied_value_usd"] for r in rows}) == 1
check("sorted_by_value", ranks == list(range(1, len(rows) + 1)) and mono and not allsame,
      f"ranks_ok={ranks == list(range(1, len(rows) + 1))} mono={mono} allsame={allsame}")
missing = [s for s in watchlist if s not in {r["slug"] for r in rows}]
check("coverage", not missing, f"missing={missing[:5]}")
# farm_steps already validated in board_file; repeat the headline
check("farm_steps", all(3 <= len(r["farm_steps"]) <= 12 and all(20 <= len(s.strip()) <= 600 for s in r["farm_steps"]) for r in rows),
      f"rows={len(rows)}")

# 6. screenshots
shots_dir = os.path.join(outdir, "screenshots")
shots = sorted(f for f in os.listdir(shots_dir) if not f.startswith("."))
ok_shots = 3 <= len(shots) <= 4
details = []
for name in shots:
    p = os.path.join(shots_dir, name)
    size = os.path.getsize(p)
    try:
        im = Image.open(p)
        im.verify()
        im = Image.open(p)
        w, h = im.size
        fmt = im.format
    except Exception as e:
        ok_shots = False
        details.append(f"{name}: unreadable {e}")
        continue
    ok = size <= 512 * 1024 and fmt in ("PNG", "JPEG") and max(w, h) <= 1440 and min(w, h) >= 800
    ok_shots = ok_shots and ok
    details.append(f"{name}: {fmt} {w}x{h} {size}B")
check("screenshots", ok_shots, "; ".join(details))

# 7. dossier_matches (byte compare against a fresh buildDossier run)
print("dossier_matches: run via node (see below); dossier bytes =", os.path.getsize(os.path.join(outdir, "dossier.json")))

print()
if fails:
    print("FAILED:", ", ".join(fails))
    sys.exit(1)
print("ALL LOCAL GATE CHECKS PASSED (dossier byte-compare pending)")
