#!/usr/bin/env python3
"""Take the four token-radar screenshots with Playwright Chromium.
Usage: python3 shot.py <outdir> <screenshots-dir>
1-board.png: the board in the VERIFIED view (176 rows — flagged/unresolved hidden).
2-detail.png: the detail view of the top watchlist protocol, scrolled into view.
3-filtered.png: the board filtered to the FARM verdict, table scrolled into view.
4-farm-next.png: the Farm Next card (best farms by $/h + distribution), scrolled into view.
Viewport 1440x1000 (long side <=1440, short side >=800) so the denser radar-7 cover
shows 8+ rows. PNG output; sizes printed.
NOTE: shot 2 targets veda (rank 1 under radar-7 odds) — check out/board.json first; if a
later run lifts another watchlist protocol to rank 1, point shot 2 at that slug instead
so the detail screenshot matches the top of the board.
"""
import sys
from playwright.sync_api import sync_playwright

outdir, shots_dir = sys.argv[1], sys.argv[2]
base = "file://" + outdir + "/dashboard/index.html"

with sync_playwright() as pw:
    browser = pw.chromium.launch(executable_path="/home/hatch/workspace/makefun/chrome-linux64/chrome", args=["--no-sandbox", "--disable-dev-shm-usage"])
    page = browser.new_page(viewport={"width": 1440, "height": 1000})
    # 1. board, VERIFIED view: the first impression hides the 4 flagged + 18 unresolved rows
    page.goto(base + "#view=screened", wait_until="load")
    page.wait_for_timeout(800)
    page.screenshot(path=shots_dir + "/1-board.png")
    # 2. detail (top protocol: Veda, rank 1 under radar-7 odds)
    page.goto(base + "#detail=veda", wait_until="load")
    page.wait_for_timeout(800)
    page.evaluate("document.querySelector('.detail').scrollIntoView()")
    page.wait_for_timeout(300)
    page.screenshot(path=shots_dir + "/2-detail.png")
    # 3. filtered (FARM verdict: the rows that pay after all costs)
    page.goto(base + "#verdict=FARM", wait_until="load")
    page.wait_for_timeout(800)
    page.evaluate("document.querySelector('.controls-section').scrollIntoView()")
    page.wait_for_timeout(300)
    page.screenshot(path=shots_dir + "/3-filtered.png")
    # 4. farm next (best farms by $/h + distribution)
    page.goto(base, wait_until="load")
    page.wait_for_timeout(800)
    page.evaluate("document.querySelector('.farm-next-card').scrollIntoView()")
    page.wait_for_timeout(300)
    page.screenshot(path=shots_dir + "/4-farm-next.png")
    browser.close()

import os
for name in ["1-board.png", "2-detail.png", "3-filtered.png", "4-farm-next.png"]:
    p = os.path.join(shots_dir, name)
    print(name, os.path.getsize(p), "bytes")
