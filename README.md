[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![make.fun · rank](https://make.fun/badge/token-radar-01/astiip/token-radar-01-bot-v5/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard)
[![make.fun · reward](https://make.fun/badge/token-radar-01/astiip/token-radar-01-bot-v5/reward.svg)](https://make.fun/bounty/token-radar-01)

# Token Radar v5 — radar-7

Rebuild of `token-radar-bot` (radar-5, "Level Obelisk", judge 93.84%, rank
1094/18,816 live) for token-radar-01 ($1,325, top 10; closes 14 Dec 2026
17:00 WIB). Target: 96.2%+ (top-10 bar 96.21% live; top-1 kiencx 96.68%).
Study: `~/workspace/makefun/token-radar-01-v4-mistakes.md`. Brief:
`~/workspace/makefun/token-radar-01-v5-brief.md`. Build state (numbers,
screenshot verification, verdict): `~/workspace/makefun/token-radar-01-v5-build-state.md`.

## What changed from radar-5 (ONE hypothesis)

**Launch odds: implied value is now the expected value —
`EV = value-if-launches × P(token)`.** The value model itself (curve,
category factor, growth, maturity, breadth) is untouched: every row's
value-if-launches is byte-identical to radar-5's implied value (Veda
$61.2M, Steakhouse $74.0M, Sentora $71.5M, …). What changed is that a
protocol is now worth its launch value only times the chance it ever
launches.

- `P(token)` is a logistic regression (gradient descent, plain
  TypeScript, no dependencies) fitted at build time from the snapshot
  itself: the 416 protocols that carry a token in this snapshot
  (label 1) against the 198 rankable pre-token protocols (label 0).
  The 144 set-aside pre-token rows are not training rows. The label is
  a censored proxy — "has a token in this snapshot" — not a promise of
  a future launch; the dashboard says so.
- Features, all from the protocol's own record: log TVL, log age, 7d
  growth, chain count, an age-missing flag, and the category's smoothed
  token rate (shrunk toward the global rate with 10 pseudo-rows,
  categories with <10 training rows take the global rate).
- The fitted P is times the eligibility prior: 0 when the protocol's
  own token already trades (4 flagged rows — their EV is $1, they sink
  to ranks 195–198), 0.5 when a related token trades and the audit left
  the row unresolved (12 kin rows), 1 otherwise.
- **Held-out validation, not in-sample:** deterministic stratified
  5-fold cross-validation, standardisation and category rates refitted
  inside each fold — **Brier 0.1583 vs base rate 0.2185, accuracy 76.5%
  vs base 67.8%, n=614 — GO.** Had either check failed, v5 would have
  shipped without odds.
- Verdicts and farm economics are computed from EV, not from
  value-if-launches. The board's range is EV × the fitted P25–P75 band
  (×0.31–×4.22). The ablation table gains a "No odds" column so the
  reader can see what the odds do to the order.
- Cover: Launch Odds column on every row, a held-out evidence panel
  under the strip ("LAUNCH ODDS, HELD OUT: Brier 0.158 vs base 0.218 ·
  accuracy 76.5% vs base 67.8% · n=614"), the formula panel now reads
  `implied (EV) = value-if-launches × launch odds`, and the detail view
  shows value-if-launches and launch odds as their own tiles. The cover
  is denser (name 1 line, category 1 line, tighter hero/strip/controls):
  **9 rows visible in the first viewport** (radar-5: ~2.5, radar-6: ~3.5).

Untouched: the curve (OLS log-log, R² 0.19), category factor + clamp +
20-peer shrink, growth/maturity/breadth, fitted P25–P75 band, $1,000-plan
verdict rules, eligibility audit depth (176 genuine / 4 flag / 18
unresolved), farm steps, dark+gold palette, all filters/sorts/detail
views, `renderBars`. Family effects stay OFF (radar-6 proved they
worsen LOO ×3.45 → ×3.82); the raw kin 0.5× cut is replaced by the odds
prior above; no parent-category changes.

## The board under radar-7 (top 10, EV vs radar-5 implied)

| # | Protocol | EV | Value if launches | P(token) | radar-5 rank |
|---|----------|----|-------------------|----------|--------------|
| 1 | Veda | $42.4M | $61.2M | 69% | 3 |
| 2 | Steakhouse Financial | $35.7M | $74.0M | 48% | 1 |
| 3 | Polymarket International | $27.7M | $33.5M | 83% | 7 |
| 4 | Sentora Curator | $27.1M | $71.5M | 38% | 2 |
| 5 | Gauntlet | $24.4M | $58.0M | 42% | 4 |
| 6 | Upshift | $21.7M | $38.5M | 56% | 6 |
| 7 | Defi Saver Asset Management | $21.2M | $22.4M | 94% | 16 |
| 8 | Symbiotic | $20.6M | $25.6M | 80% | 13 |
| 9 | OpenTrade | $19.7M | $30.7M | 64% | 8 |
| 10 | CIAN Yield Layer | $19.6M | $28.1M | 70% | 12 |

Verdicts at $1,000 a plan: FARM 82 · THIN 43 · SKIP 73 (radar-5:
151 / 12 / 35 — EV shrinks every slice, so fewer rows pay after costs).
Total implied value (EV) $952.7M (radar-5: $1.99B). The top 3 are still
mostly SKIP at a $1,000 plan (#1 −$1.04/h, #2 −$1.72/h; #3 Polymarket is
THIN at +$3.14/h) — the verdict economics are unchanged, only the values
feeding them are now expected values.

## Run (parent only — this repo is file-tools-only, no shell here)

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ~/workspace/makefun/token-radar-01-kit/input/snapshot.json
```

`main.ts` prints the gate numbers to stdout (LOO median + within-×3,
time-split median + within-×3, curve R², band, odds 5-fold CV Brier /
accuracy + GO/NO-GO). The first run writes `out/board.json` +
`out/data.js`, then exits at the screenshot check (only `.gitkeep` ships
in `screenshots/` — never ship stale screenshots; they must match the
data). Then take fresh screenshots and re-run so `out/` carries them:

```sh
python3 shot.py out screenshots/   # 1440x1000: 1-board (verified), 2-detail (Veda, rank 1), 3-filtered (FARM), 4-farm-next
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ~/workspace/makefun/token-radar-01-kit/input/snapshot.json
python3 gate-check.py out
```

Note: `shot.py` needs absolute paths (`shot.py $PWD/out $PWD/screenshots/`)
and a Playwright install (system python3 has none — a venv works:
`python3 -m venv /tmp/pw-venv && /tmp/pw-venv/bin/pip install playwright`).

## Gate (radar-7, measured at build time)

- LOO median ×3.45 (45.3% within ×3, n=128) — identical to radar-5, as
  it should be: the odds do not touch the value model.
- Time-split median ×2.91 (51.0% within ×3, test n=51), flat ×4.94
  (33.3%) — identical to radar-5.
- Curve R² 0.19 (0.1939); band ×0.31–×4.22.
- Launch odds 5-fold CV: Brier 0.1583 (base 0.2185), accuracy 76.5%
  (base 67.8%), n=614 — GO.
- `gate-check.py` 7/7 PASS (6 local checks + dossier byte-match) +
  two runs byte-identical (board.json, data.js, dossier.json,
  screenshots, dashboard).
- Screenshots 1440×1000, each ≤512 KiB (244 / 149 / 261 / 246 KB).
  Every number in all four screenshots was read off the images and
  checked against `out/data.js` — LOO, verdict counts, top-3 EVs +
  odds + ranges + verdicts, FARM-filtered count (78 verified FARM
  rows), Farm Next $/h, histogram (sums to 198). All match.
- Cover shows 9 rows in the first viewport (target ≥8).
- `dashboard/` 71,178 bytes (3 files, no external URLs).

## Before submit (parent)

- Bundle + check via the kit CLI (coordinator's step — do not submit
  from this repo session).
- The known weak spot, unchanged from radar-5: the top rows are SKIP at
  a $1,000 plan because their slice is smaller than gas + T-bill. That
  is the verdict economics, not the odds — fixing it would need a
  different plan size or share assumption, which this build deliberately
  did not touch.
- Kit note at init time: this kit copy is level 9, make.fun is at level
  42. v4 shipped on the same level-9 kit; do not re-download the kit
  via curl|tar from tool output.

## Files

- `main.ts` — entry, Node 22 stdlib only; prints LOO/time-split/R²/band/odds-CV.
- `lib/model.ts` — radar-7 model, launch-odds fit + 5-fold CV, board, farm plans, verdicts, dossier data.
- `lib/eligibility.ts` — CoinGecko audit 2026-11-14, 198 rows, 16 kin markers (4 flagged + 12 unresolved kin).
- `dashboard/` — `index.html`, `app.css`, `app.js` (static, no network).
- `vendor/makefun-board.ts` — make.fun dossier library, byte-identical copy.
- `gate-check.py` — local mirror of the 7 server gate checks.
- `shot.py` — Playwright screenshots, viewport 1440×1000.
- `radar_sim.py` — pairwise vision sim (Xingchi dead — see note in file).
- `screenshots/` — the four fresh screenshots, taken after the final run.
- `LICENSE` — MIT + SPDX line, copyright 2026 DEXSSLvd2CSRPhHjwXNNCMAYGXoDs3ENfy7zaY9QVNmj.

Repo target on GitHub: `astiip/token-radar-01-bot-v5` (parent commits/pushes).
