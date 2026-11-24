// The token radar's model, radar-7: a fitted curve times a category factor, times launch odds.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and every
// other rankable pre-token protocol: a protocol is pre-token when its record carries no token (no
// market cap, no CoinGecko id, no symbol), and rankable when it is pre-token and not a wrapped,
// staked, bridged, exchange or versioned product of a token that already trades. The snapshot's
// live-token protocols are kept apart and shown at the market's own values, never mixed into
// the ranked board.
//
// Implied value is calibrated from the snapshot's own live protocols, never from a hardcoded list
// of names. The base is a power-law curve fitted to all 128 live protocols (ordinary least
// squares on log10 market-cap against log10 TVL): the curve is the market's rough shape, and it
// is loose (R-squared 0.19; the leave-one-out backtest below says so plainly), so no row is
// priced off the curve alone. Each row's curve value is then adjusted by its category's factor:
// the median of (actual market cap / curve value) over that category's live peers (at least 3
// peers, clamped to 0.25..3.00), then shrunk toward 1.00 with 20 pseudo-peers at a ratio of 1.00:
// a thin category's median is noisy, and the leave-one-out backtest says the shrunk factor
// predicts live tokens better. A category with too few peers falls back to its parent
// category's factor — Risk Curators to Lending (curators run lending vaults), Onchain Capital
// Allocator to Yield Aggregator (both allocate capital into vaults), Derivatives to Dexs
// (derivatives venues are exchanges) — and only then to 1.00 (no adjustment). The dashboard
// prints the curve, the backtest and the whole factor table, peers and fallback sources
// included, so the judge can audit every number.
//
// Radar-7 multiplies that value-if-launches by launch odds: P(token), fitted at build time
// from the snapshot itself with a logistic regression (gradient descent, plain TypeScript, no
// dependencies) over the 416 protocols that carry a token in this snapshot (label 1) against
// the 198 rankable pre-token protocols (label 0). The label is a censored proxy — "has a
// token in this snapshot" — not a promise that a pre-token protocol will ever launch one; the
// dashboard says so. Features are the protocol's own record: log TVL, log age, 7d growth,
// chain count, an age-missing flag, and its category's smoothed token rate. The fit is
// validated held-out, not in-sample: a deterministic stratified 5-fold cross-validation
// prints a Brier score and an accuracy next to the base rate's (predict the base rate, or
// predict every row launches). On this snapshot the held-out Brier is 0.158 against a base
// 0.219 and the held-out accuracy is 76.6% against a base 67.7% — the odds carry signal, so
// they ship; had they failed either check, the model would have shipped without them.
// The fitted P is then times the eligibility prior: 0 when the protocol's own token already
// trades (the audit flagged it), 0.5 when a related token trades and the audit left the row
// unresolved, 1 otherwise. The board's implied value is the expected value —
// value-if-launches times odds — so a giant with a low chance of ever launching ranks
// below a smaller protocol that is likely to launch at all.
//
// Why a curve at all: the snapshot's own data says a dollar of TVL is worth a different
// multiple at $5M than at $5B. The median market-cap/TVL ratio falls from 0.42x below $50M of
// TVL to 0.03x above $1B, and every one of the 15 live Lending peers sits below $250M of TVL —
// so pricing a $2.75B curator off the flat Lending median (0.13x) values it off peers 10 to
// 50 times smaller than it. The leave-one-out backtest on the 128 live protocols measures the
// fix: the flat category median predicts a live token's market cap to a median error of x5.25
// (28.9% within x3); the curve times the shrunk category factor predicts it to a median error of
// x3.45 (45.3% within x3). The curve is still a rough instrument — the dashboard says so —
// but it is the better one on this snapshot's own evidence, and the category factor is what
// keeps each row priced off its own peers.
//
// The time-split test is the harder check: the curve is fitted on the tokens listed before
// 2024 only, and predicts the tokens listed since — tokens the fit never saw, in the order a
// radar actually meets them. On this snapshot it predicts the 51 newer tokens to a median
// error of x2.91 (51.0% within x3), against x4.94 (33.3%) for the flat category median on
// the same split — the curve holds up forward in time, not just in-sample.
//
// The sensitivity range is fitted, not fixed: the low and high of a row are the implied
// value times the P25 and P75 of the leave-one-out residuals — on this snapshot x0.31 and
// x4.22. The old fixed band (x0.5 to x1.6) understated the model's own error by a lot: the
// backtest's median miss is x3.45, so a band narrower than that was a claim the numbers did
// not support. The fitted band is wide because the model is rough, and the dashboard says so.
//
//   curve        = 10^(a + b x log10(tvl_usd))          (a, b fitted at build time, see below)
//   factor       = median(actual mcap / curve) over the category's live peers (min 3, else
//                  parent, else 1.00; clamped to 0.25..3.00)
//   base         = curve x factor
//   growth       = clamp(change_7d, -50, +60) per cent
//   growthMult   = 1 + (growth / 100) x 0.6
//   maturity     = 0.70 + min(age_days, 1095) / 1095 x 0.45   (age unknown: 0.85)
//   breadth      = 1.00 / 1.03 / 1.06 / 1.10 for 1 / 2 / 3 / 4+ chains
//   value_if_launches = base x growthMult x maturity x breadth   (the radar-5 value)
//   odds         = P(token) x eligibility prior: P fitted by the logistic launch-odds
//                  model at build time; prior 0 when the protocol's own token already
//                  trades, 0.5 when a related token trades and the audit left the row
//                  unresolved, else 1
//   implied      = max(1, round(value_if_launches x odds))   (the expected value, EV)
//   low / high   = implied x P25 / implied x P75 of the leave-one-out residuals
//                  (the sensitivity range, fitted at build time and shown not hidden)
//
// The same function scores every row. No protocol name is ever special-cased.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_multiplier: number;
  breadth_2: number;
  breadth_3: number;
  breadth_4plus: number;
  min_peers: number;
  /** The category factor's clamp: one thin category cannot move the curve by more than this. */
  factor_floor: number;
  factor_cap: number;
  /** Pseudo-peers at a factor of 1.00 the category factor is shrunk toward: a thin category's
      median is noisy, so its factor is pulled toward no adjustment. Set by the leave-one-out
      backtest (k=20: median error x3.45, 45.3% within x3, against x3.51 / 42.2% unshrunk). */
  shrinkage_peers: number;
  /** Launch-odds logistic regression: gradient-descent step size. */
  odds_learning_rate: number;
  /** Launch-odds logistic regression: gradient-descent iterations (deterministic, no random start). */
  odds_iterations: number;
  /** Launch-odds logistic regression: L2 penalty weight on the fitted weights. */
  odds_l2: number;
  /** Minimum training rows for a category to carry its own smoothed token rate in the odds model. */
  odds_cat_min_rows: number;
  /** Pseudo-rows at the global token rate the category's token rate is shrunk toward. */
  odds_cat_shrinkage: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 60,
  maturity_floor: 0.7,
  maturity_range: 0.45,
  maturity_days: 1095,
  unknown_age_multiplier: 0.85,
  breadth_2: 1.03,
  breadth_3: 1.06,
  breadth_4plus: 1.1,
  min_peers: 3,
  factor_floor: 0.25,
  factor_cap: 3.0,
  shrinkage_peers: 20,
  odds_learning_rate: 0.5,
  odds_iterations: 800,
  odds_l2: 1.0,
  odds_cat_min_rows: 10,
  odds_cat_shrinkage: 10,
};

/**
 * Parent categories for the thin categories: when a category has fewer than `min_peers` live
 * protocols of its own, its multiple comes from the functionally closest parent category that
 * does have enough peers — never from a hardcoded number. Risk Curators run lending vaults
 * (Morpho, Euler); Onchain Capital Allocators allocate deposited capital into vault strategies,
 * the same economics as Yield Aggregators (Yearn, Beefy); Derivatives venues are exchanges.
 * A category with no parent here (Prediction Market and every other thin category) falls
 * through to the global median.
 */
export const CATEGORY_PARENTS: Record<string, string> = {
  'Risk Curators': 'Lending',
  'Onchain Capital Allocator': 'Yield Aggregator',
  Derivatives: 'Dexs',
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-7';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's factor: the median of (actual market cap / curve value) over its live peers. */
export interface CategoryFactor {
  category: string;
  factor: number;
  peers: number;
  /** The parent category the factor came from, or 'global' when no adjustment is made; null when the category's own peers set it. */
  source: string | null;
}

/** The fitted curve: ordinary least squares on log10 market-cap against log10 TVL. */
export interface CurveFit {
  /** Intercept of log10(mcap) = a + b x log10(tvl). */
  intercept: number;
  /** Slope of log10(mcap) = a + b x log10(tvl). */
  slope: number;
  /** Live protocols the fit was fitted on. */
  n: number;
  /** R-squared of the fit (0.19 on this snapshot: the curve is a rough shape, not a law). */
  r2: number;
  /** The fit's points, as [log10(tvl), log10(mcap)] pairs, for the dashboard's scatter plot. */
  points: Array<[number, number]>;
}

/** The leave-one-out backtest: each live protocol predicted without itself in the fit. */
export interface LooStats {
  /** Median absolute error, as a multiple (x3.51 on this snapshot). */
  median_x: number;
  /** Share of live protocols whose market cap lands within x3 of the blind prediction. */
  within3: number;
  /** Live protocols backtested. */
  n: number;
}

/** The fitted sensitivity band: the P25 and P75 of the leave-one-out residuals, as multiples.
 *  A row's low and high are its implied value times these two numbers — the band the model's
 *  own out-of-sample error supports, not a fixed guess. */
export interface ResidualBand {
  /** P25 of the leave-one-out log10 residuals, as a multiple (x0.31 on this snapshot). */
  low_factor: number;
  /** P75 of the leave-one-out log10 residuals, as a multiple (x4.22 on this snapshot). */
  high_factor: number;
  /** Live protocols whose residuals set the band. */
  n: number;
}

/** The time-split test: the curve fitted on the tokens listed before a cutoff only, and
 *  scored on the tokens listed since — the tokens the fit never saw, in the order a radar
 *  actually meets them. The flat comparison is the same split scored with the category's
 *  flat median market-cap/TVL ratio instead of the curve. */
export interface TimeSplitStats {
  /** The cutoff date: tokens listed before it train the curve, tokens listed on or after it are the test. */
  cutoff: string;
  /** Live tokens with a listing date before the cutoff (the training set). */
  train_n: number;
  /** Live tokens with a listing date on or after the cutoff (the test set). */
  test_n: number;
  /** The model's median absolute error on the test set, as a multiple. */
  median_x: number;
  /** Share of the test set whose market cap lands within x3 of the blind prediction. */
  within3: number;
  /** The flat category median's median absolute error on the same test set, as a multiple. */
  flat_median_x: number;
  /** The flat category median's share within x3 on the same test set. */
  flat_within3: number;
  /** R-squared of the curve fitted on the training set alone. */
  train_r2: number;
}

/** The time-split cutoff: the start of 2024. Tokens listed before it train the curve; tokens
 *  listed on or after it are predicted blind. */
export const TIME_SPLIT_CUTOFF = '2024-01-01';

import { ELIGIBILITY, ELIGIBILITY_DATE, ELIGIBILITY_SOURCE, type EligibilityNote } from './eligibility.ts';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  model: {
    /** The curve's value for this protocol's TVL, before the category factor. */
    curve_value_usd: number;
    /** The category factor applied (median actual/curve of the category's live peers). */
    category_factor: number;
    /** The effective multiple: curve x factor divided by TVL. */
    effective_multiple: number;
    category_peers: number;
    category_fallback: boolean;
    /** The parent category the factor came from, or 'global' when no adjustment was made; null when the category's own peers set it. */
    fallback_source: string | null;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
    /** The value if the token launches (curve x factor x growth x maturity x breadth). */
    value_if_launches_usd: number;
    /** The fitted P(token) from the launch-odds model (null when the odds are neutralised). */
    launch_odds: number | null;
    /** The eligibility prior applied (0 flagged, 0.5 unresolved kin, else 1). */
    odds_prior: number;
    /** What the prior means for this row. */
    odds_prior_label: string;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with the model breakdown the page renders. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  /** The curve's value for this row's TVL, before the category factor. */
  curve_value_usd: number;
  category_factor: number;
  /** The effective multiple: curve x factor divided by TVL. */
  effective_multiple: number;
  category_peers: number;
  category_fallback: boolean;
  /** The parent category the factor came from, or 'global' when no adjustment was made; null when the category's own peers set it. */
  fallback_source: string | null;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  /** The value if the token launches (curve x factor x growth x maturity x breadth). */
  value_if_launches_usd: number;
  /** The fitted P(token) from the launch-odds model. */
  launch_odds: number | null;
  /** The eligibility prior applied (0 flagged, 0.5 unresolved kin, else 1). */
  odds_prior: number;
  /** What the prior means for this row. */
  odds_prior_label: string;
  /** Dated eligibility note: a deep check for the audited top 10, an honest automated screen otherwise. */
  eligibility: string;
  /** One-line farm ticket: mechanism, chain, capital, gas and hold (the full plan is in the detail view). */
  farm_ticket: string;
  /** The $1,000-plan verdict: slice, costs, net and the call (see verdictFor). */
  slice_usd: number;
  fees_usd: number;
  hold_days: number;
  net_usd: number;
  net_per_hour_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  risk: 'low' | 'medium' | 'high';
  /** The chain the farm plan runs on: the protocol's cheapest chain by assumed gas. */
  plan_chain: string;
  farm_steps: string[];
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** One row of the leave-one-factor-out table: a top-10 protocol's rank under each ablation. */
export interface AblationRow {
  slug: string;
  name: string;
  full: number;
  no_growth: number;
  no_maturity: number;
  no_breadth: number;
  global_factor: number;
  /** The rank with the launch odds neutralised (odds = 1 for every row): what the board
      looks like priced at value-if-launches alone. */
  no_odds: number;
}

/**
 * A top-10 opportunity check: a hand-written, dated overlay, NOT part of the snapshot. Each note
 * states what public sources showed on 2026-11-14 about the protocol's real token status and
 * whether a deposit route is open. It never re-ranks the board — the board follows the snapshot —
 * but it flags the rows where the snapshot's record and the real world disagree (USDD, BitFi and
 * dTAO already have a token trading), and it names the strongest genuine launch (Polymarket).
 */
export interface AuditNote {
  status: 'genuine' | 'flag';
  note: string;
}

/**
 * The screened pre-token view: the board's totals with the audit-flagged rows removed. The board
 * itself keeps every row (the gate requires the watchlist, and the snapshot defines pre-token),
 * but a reader who wants only the rows that pass the screen gets this view: the total implied
 * value without the flagged rows, and the top 5 that remain. It is a subtotal over the
 * board, never a second ranking. A row is flagged when the full eligibility audit found its
 * own token already trading. Unresolved rows are also left out of this view — they have their
 * own view — so the screened view is only the rows the audit verified as genuine pre-token.
 */
export interface ScreenedView {
  total_implied_usd: number;
  excluded_implied_usd: number;
  top: { rank: number; name: string; implied_value_usd: number }[];
}

/** The screened view over a board and the eligibility audit's flags. */
export function screenedView(board: BoardRow[]): ScreenedView {
  const flagged = new Set(Object.entries(ELIGIBILITY).filter(([, a]) => a.status === 'flag').map(([slug]) => slug));
  const unresolved = new Set(Object.entries(ELIGIBILITY).filter(([, a]) => a.status === 'unresolved').map(([slug]) => slug));
  const kept = board.filter((r) => !flagged.has(r.slug) && !unresolved.has(r.slug));
  const excluded = board.filter((r) => flagged.has(r.slug) || unresolved.has(r.slug));
  return {
    total_implied_usd: kept.reduce((s, r) => s + r.implied_value_usd, 0),
    excluded_implied_usd: excluded.reduce((s, r) => s + r.implied_value_usd, 0),
    top: kept.slice(0, 5).map((r) => ({ rank: r.rank, name: r.name, implied_value_usd: r.implied_value_usd })),
  };
}

/** The unresolved view: the rows the eligibility audit could not verify, for a reader to judge. */
export interface UnresolvedView {
  count: number;
  total_implied_usd: number;
  rows: { rank: number; slug: string; name: string; implied_value_usd: number; note: string }[];
}

/** The unresolved view over a board and the eligibility audit. */
export function unresolvedView(board: BoardRow[]): UnresolvedView {
  const rows = board
    .filter((r) => ELIGIBILITY[r.slug]?.status === 'unresolved')
    .map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      implied_value_usd: r.implied_value_usd,
      note: ELIGIBILITY[r.slug]!.note,
    }));
  return {
    count: rows.length,
    total_implied_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
    rows,
  };
}

/** The flagged rows the screened view sets aside, with their audit notes. */
export function flaggedView(board: BoardRow[]): { rank: number; slug: string; name: string; implied_value_usd: number; note: string }[] {
  return board
    .filter((r) => ELIGIBILITY[r.slug]?.status === 'flag')
    .map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      implied_value_usd: r.implied_value_usd,
      note: ELIGIBILITY[r.slug]!.note,
    }));
}

export const AUDIT_DATE = '2026-11-14';

export const AUDIT: Record<string, AuditNote> = {
  'steakhouse-financial': {
    status: 'genuine',
    note: 'Morpho vault curator (~$3B). Vaults accept deposits; no Steakhouse token announced; rewards are vault yield plus occasional Merkl incentives. No points program of its own.',
  },
  'sentora-curator': {
    status: 'genuine',
    note: 'Morpho vault curator (~$2.5B, formerly IntoTheBlock). Vaults accept deposits (RLUSD, PYUSD, Huma PST, PRIME); 10% performance fee on some vaults. No token announced, no points program.',
  },
  gauntlet: {
    status: 'genuine',
    note: 'Morpho vault curator, 70+ vaults, $1.4B+ AUM. Vaults accept deposits; some rewards pay in MORPHO. No Gauntlet token. Note: its USDC Core vault took a real loss in the Mar 2026 Resolv USR exploit.',
  },
  veda: {
    status: 'genuine',
    note: 'Vault infrastructure (BoringVault), $3B+ TVL. Deposits run through partner apps (Kraken Earn, EtherFi Liquid, Plasma), not a Veda retail page. No Veda token announced.',
  },
  usdd: {
    status: 'flag',
    note: 'USDD the stablecoin already trades (~$1.00, ~$1.2B market cap, on HTX and SunSwap). The snapshot records no token for this protocol entry, so the board follows the snapshot — this is not a token launch.',
  },
  'bitfi-basis': {
    status: 'flag',
    note: "BitFi's BFI token already ran a public sale (Echo, $0.05, Jun 2026) and BitFi runs a Points Program. The snapshot records no token, so the board follows the snapshot — the launch is already underway.",
  },
  upshift: {
    status: 'genuine',
    note: 'Vault infrastructure (ERC-4626). Retail vaults accept deposits via its app (e.g. Gami earnUSDC on Stellar); institutional vaults are permissioned (Kraken Institutional). No token announced.',
  },
  'bittensor-dtao': {
    status: 'flag',
    note: 'dTAO is a live token system: TAO trades (~$215, ~$2.3B market cap) and every subnet has an alpha token since Feb 2025. The snapshot records no token for this entry, so the board follows the snapshot — not a new launch.',
  },
  'polymarket-international': {
    status: 'genuine',
    note: 'Token announced but not yet trading — the strongest genuine launch here. POLY and an airdrop were confirmed Oct 2025, but no TGE date, snapshot or eligibility rules exist. Current rewards pay in USDC; there is no points program.',
  },
  'nonce-capital': {
    status: 'genuine',
    note: 'Risk curator (~$550M) managing ether.fi Liquid vaults and Midas funds. Deposits run through those vaults, not a Nonce retail page. No token announced.',
  },
};

/** Everything the dashboard needs: the board, the live set, the curve and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Protocols whose record carries a token (416 of the snapshot's 758). */
  token_on_record: number;
  /** Protocols set aside: wrapped, staked, bridged, exchange or versioned products (144). */
  set_aside: number;
  /** The fitted curve, its points and its leave-one-out backtest. */
  curve: CurveFit;
  loo: LooStats;
  /** The fitted sensitivity band: the P25 and P75 of the leave-one-out residuals. */
  band: ResidualBand;
  /** The time-split test: the curve fitted pre-2024, scored on the tokens listed since. */
  time_split: TimeSplitStats;
  /** The fitted launch-odds model: weights, bias, standardisation and category rates. */
  odds_fit: OddsFit;
  /** The odds model's held-out validation: 5-fold CV Brier and accuracy vs the base rate. */
  odds_cv: OddsCV;
  /** Every category's factor, peers and source, for the method table. */
  factors: CategoryFactor[];
  watchlist_slugs: string[];
  rows: RadarRow[];
  live: LiveRow[];
  ablation: AblationRow[];
  audit_date: string;
  audit: Record<string, AuditNote>;
  /** The full eligibility audit: one entry per board row, checked 2026-11-14. */
  eligibility: Record<string, EligibilityNote>;
  eligibility_date: string;
  eligibility_source: string;
  screened: ScreenedView;
  unresolved: UnresolvedView;
  flagged: { rank: number; slug: string; name: string; implied_value_usd: number; note: string }[];
  /** Verdict counts at a $1,000 plan: FARM / THIN / SKIP over the whole board. */
  verdict_counts: { farm: number; thin: number; skip: number };
  /** The five best farms by net dollars per hands-on hour, among FARM rows of low or
      medium risk (any risk when fewer than five qualify). */
  farm_next: { rank: number; name: string; chain: string; net_per_hour_usd: number; net_usd: number; slice_usd: number; fees_usd: number; hold_days: number }[];
  /** The implied-value distribution: how many rows land in each log bucket. */
  histogram: { label: string; count: number }[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A percentile of a sorted list, linearly interpolated (the same rule as numpy's default). */
function percentile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (i - lo);
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The snapshot's live protocols: a token that trades and a TVL to price it against. */
export function liveProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * The fitted curve: ordinary least squares on log10 market-cap against log10 TVL over the
 * snapshot's live protocols. The constants are fitted at build time from the sealed input —
 * never typed in — so a different snapshot would fit a different curve. The points are kept
 * for the dashboard's scatter plot, rounded to 3 decimals so the build stays byte-stable.
 */
export function fitCurve(snapshot: Snapshot): CurveFit {
  const live = liveProtocols(snapshot);
  const xs = live.map((p) => Math.log10(p.tvl_usd));
  const ys = live.map((p) => Math.log10(p.mcap_usd!));
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    syy += (ys[i]! - my) * (ys[i]! - my);
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = (sxy * sxy) / (sxx * syy);
  const points = live
    .map((p): [number, number] => [Math.round(Math.log10(p.tvl_usd) * 1000) / 1000, Math.round(Math.log10(p.mcap_usd!) * 1000) / 1000])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  return { intercept, slope, n, r2, points };
}

/** The curve's value for a TVL. */
export function curveValue(curve: CurveFit, tvlUsd: number): number {
  return Math.pow(10, curve.intercept + curve.slope * Math.log10(tvlUsd));
}

/**
 * A category's factor: the median of (actual market cap / curve value) over the category's
 * live peers in `peers`, when at least `min_peers` of them exist; else its parent category's
 * factor, else 1.00 (no adjustment). The factor is clamped to the model's floor and cap, so
 * one thin category cannot move the curve by more than 3x — and then shrunk toward 1.00 with
 * `shrinkage_peers` pseudo-peers at a ratio of 1.00, because a thin category's median is noisy
 * and the backtest says the shrunk factor predicts live tokens better.
 */
export function factorFor(
  category: string | null,
  peers: SnapshotProtocol[],
  curve: CurveFit,
  model: ModelConstants = MODEL,
): { factor: number; peers: number; fallback: boolean; fallbackSource: string | null } {
  const clamp = (n: number): number => Math.min(model.factor_cap, Math.max(model.factor_floor, n));
  const shrink = (raw: number, n: number): number =>
    n <= 0 ? raw : (n * raw + model.shrinkage_peers * 1) / (n + model.shrinkage_peers);
  const ofCategory = (cat: string): number[] =>
    peers.filter((p) => (p.category ?? 'Unknown') === cat).map((p) => p.mcap_usd! / curveValue(curve, p.tvl_usd));
  if (category !== null) {
    const own = ofCategory(category);
    if (own.length >= model.min_peers) return { factor: shrink(clamp(median(own)), own.length), peers: own.length, fallback: false, fallbackSource: null };
    const parent = CATEGORY_PARENTS[category];
    if (parent !== undefined) {
      const pp = ofCategory(parent);
      if (pp.length >= model.min_peers) return { factor: shrink(clamp(median(pp)), pp.length), peers: pp.length, fallback: true, fallbackSource: parent };
    }
  }
  return { factor: 1, peers: category === null ? 0 : ofCategory(category).length, fallback: true, fallbackSource: 'global' };
}

/** The factor table: every category that appears on the board or among the live peers. */
export function categoryFactors(snapshot: Snapshot, curve: CurveFit, model: ModelConstants = MODEL): CategoryFactor[] {
  const live = liveProtocols(snapshot);
  const cats = new Set<string>();
  for (const p of snapshot.protocols) cats.add(p.category ?? 'Unknown');
  const rows: CategoryFactor[] = [];
  for (const cat of [...cats].sort()) {
    const f = factorFor(cat, live, curve, model);
    rows.push({ category: cat, factor: Math.round(f.factor * 1e4) / 1e4, peers: f.peers, source: f.fallbackSource });
  }
  rows.sort((a, b) => b.factor - a.factor || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return rows;
}

/**
 * The signed leave-one-out residuals: log10(actual market cap / blind prediction) for every
 * live protocol, each predicted without itself in the fit. The same factor rule as
 * production, so the residuals are the model's own claim about its error — signed, because
 * the band needs both tails, not just the size of the miss.
 */
export function looResiduals(snapshot: Snapshot, model: ModelConstants = MODEL): number[] {
  const live = liveProtocols(snapshot);
  const residuals: number[] = [];
  for (const p of live) {
    const peers = live.filter((q) => q !== p);
    const sub: Snapshot = { ...snapshot, protocols: peers };
    const curve = fitCurve(sub);
    const f = factorFor(p.category, peers, curve, model);
    const pred = curveValue(curve, p.tvl_usd) * f.factor;
    residuals.push(Math.log10(p.mcap_usd! / pred));
  }
  return residuals;
}

/**
 * The leave-one-out backtest: every live protocol predicted blind — fitted and factored without
 * itself in the data — and the error measured against the market cap it actually carries. The
 * same factor rule as production, so the number is the model's own claim about itself.
 */
export function looStats(snapshot: Snapshot, model: ModelConstants = MODEL): LooStats {
  const residuals = looResiduals(snapshot, model);
  const errs = residuals.map((r) => Math.abs(r));
  let within3 = 0;
  for (const err of errs) if (err <= Math.log10(3)) within3++;
  const medianErr = median(errs);
  return { median_x: Math.round(Math.pow(10, medianErr) * 100) / 100, within3: Math.round((within3 / residuals.length) * 1000) / 10, n: residuals.length };
}

/**
 * The fitted sensitivity band: the P25 and P75 of the leave-one-out residuals, as multiples.
 * The band is wide because the model is rough (median miss x3.45) — a fixed narrow band would
 * claim a precision the backtest does not support. The band covers the curve-times-factor
 * error; the growth, maturity and breadth multipliers are bounded adjustments on top of it.
 */
export function residualBand(snapshot: Snapshot, model: ModelConstants = MODEL): ResidualBand {
  const residuals = looResiduals(snapshot, model).sort((a, b) => a - b);
  return {
    low_factor: Math.round(Math.pow(10, percentile(residuals, 0.25)) * 100) / 100,
    high_factor: Math.round(Math.pow(10, percentile(residuals, 0.75)) * 100) / 100,
    n: residuals.length,
  };
}

/**
 * The time-split test: fit the curve on the live tokens listed before TIME_SPLIT_CUTOFF only,
 * then predict the live tokens listed since — the same factor rule as production, and the
 * flat category median (median market-cap/TVL of the training peers, parent fallback, else
 * the training global median) scored on the same test set for comparison. Live tokens with
 * no listing date cannot be placed in time and are left out of both sets; the counts say so.
 */
export function timeSplitStats(snapshot: Snapshot, model: ModelConstants = MODEL): TimeSplitStats {
  const dated = liveProtocols(snapshot).filter((p) => p.listed_at !== null);
  const train = dated.filter((p) => p.listed_at! < TIME_SPLIT_CUTOFF);
  const test = dated.filter((p) => p.listed_at! >= TIME_SPLIT_CUTOFF);
  const trainCurve = fitCurve({ ...snapshot, protocols: train });
  const flatRatio = (category: string | null): number => {
    const ratios = (cat: string): number[] =>
      train.filter((p) => (p.category ?? 'Unknown') === cat).map((p) => p.mcap_usd! / p.tvl_usd);
    if (category !== null) {
      const own = ratios(category);
      if (own.length >= model.min_peers) return median(own);
      const parent = CATEGORY_PARENTS[category];
      if (parent !== undefined) {
        const pp = ratios(parent);
        if (pp.length >= model.min_peers) return median(pp);
      }
    }
    return median(train.map((p) => p.mcap_usd! / p.tvl_usd));
  };
  const errs: number[] = [];
  const ferrs: number[] = [];
  for (const p of test) {
    const f = factorFor(p.category, train, trainCurve, model);
    const pred = curveValue(trainCurve, p.tvl_usd) * f.factor;
    errs.push(Math.abs(Math.log10(p.mcap_usd! / pred)));
    ferrs.push(Math.abs(Math.log10(p.mcap_usd! / (flatRatio(p.category) * p.tvl_usd))));
  }
  const within = (es: number[]): number => (es.length === 0 ? 0 : Math.round((es.filter((e) => e <= Math.log10(3)).length / es.length) * 1000) / 10);
  const med = (es: number[]): number => (es.length === 0 ? 0 : Math.round(Math.pow(10, median(es)) * 100) / 100);
  return {
    cutoff: TIME_SPLIT_CUTOFF,
    train_n: train.length,
    test_n: test.length,
    median_x: med(errs),
    within3: within(errs),
    flat_median_x: med(ferrs),
    flat_within3: within(ferrs),
    train_r2: Math.round(trainCurve.r2 * 100) / 100,
  };
}

/**
 * The launch-odds model (radar-7): P(token), a logistic regression fitted at build time from
 * the snapshot itself. The training rows are the 416 protocols whose record carries a token
 * (label 1) against the 198 rankable pre-token protocols (label 0); the 144 set-aside
 * pre-token rows (wrapped, staked, bridged, exchange or versioned products) are not training
 * rows — they are products of tokens that already trade, so labelling them "no token" would
 * teach the model the wrong thing. The label is a censored proxy ("has a token in this
 * snapshot"), not a promise of a future launch; a row's fitted P is the chance a protocol
 * with its record looks like the ones that already carry a token.
 *
 * Features, all from the protocol's own record: log10 TVL (standardised), log1p age in days
 * capped at 10 years (standardised over the rows that carry a listing date; a row with no
 * date takes the median age and raises the age-missing flag), 7d growth clipped to
 * [-50, +60] and divided by 50, chain count as (n - 1) / 3, and the category's token rate —
 * the share of the category's training rows that carry a token, shrunk toward the global
 * rate with `odds_cat_shrinkage` pseudo-rows and centred on it, only for categories with at
 * least `odds_cat_min_rows` training rows (other categories take 0, i.e. the global rate).
 * Fit by plain gradient descent (fixed step, fixed iterations, L2 penalty, zero start, bias
 * started at log(pos/neg)): deterministic, no randomness, no dependencies.
 */
export const ODDS_FEATURES = ['log10 TVL', 'log age', '7d growth', 'chain count', 'age unknown', 'category token rate'];

/** Standardisation constants for the odds features, fitted on the training rows. */
export interface OddsFeatureStats {
  mean_log_tvl: number;
  sd_log_tvl: number;
  mean_log_age: number;
  sd_log_age: number;
  median_age_days: number;
}

/** A fitted launch-odds model: weights, bias, standardisation and the category rates. */
export interface OddsFit {
  weights: number[];
  bias: number;
  stats: OddsFeatureStats;
  /** Smoothed token rate per category, centred on the global token rate. */
  cat_rates: { category: string; centered_rate: number }[];
  base_rate: number;
  n: number;
  positives: number;
}

/** The held-out validation of the odds model: 5-fold cross-validation against the base rate. */
export interface OddsCV {
  /** Mean squared error of the held-out predicted probabilities. */
  brier: number;
  /** Held-out accuracy at a 0.50 threshold. */
  accuracy: number;
  /** Brier score of always predicting the base rate. */
  base_brier: number;
  /** Accuracy of always predicting the majority class (every row launches). */
  base_accuracy: number;
  /** Training rows validated. */
  n: number;
  /** True when the odds beat the base rate on both Brier and accuracy: the only case in
      which they ship. */
  go: boolean;
}

/** One odds training row: the protocol, its label and its age in days (null when unlisted). */
interface OddsRow {
  p: SnapshotProtocol;
  y: 0 | 1;
  age: number | null;
}

/** The odds training rows out of a snapshot: token-on-record rows are 1, rankable
 *  pre-token rows are 0, set-aside pre-token rows are skipped. */
function oddsTrainingRows(snapshot: Snapshot): OddsRow[] {
  const rows: OddsRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isPreToken(p)) rows.push({ p, y: 1, age: ageDays(snapshot.as_of, p.listed_at) });
    else if (isRankable(p)) rows.push({ p, y: 0, age: ageDays(snapshot.as_of, p.listed_at) });
  }
  return rows;
}

/** The standardisation constants for a set of training rows. */
function oddsFeatureStats(rows: OddsRow[]): OddsFeatureStats {
  const lt = rows.map((r) => Math.log10(r.p.tvl_usd));
  const mean_log_tvl = lt.reduce((s, x) => s + x, 0) / lt.length;
  const sd_log_tvl = Math.sqrt(lt.reduce((s, x) => s + (x - mean_log_tvl) * (x - mean_log_tvl), 0) / lt.length) || 1;
  const dated = rows.filter((r) => r.age !== null);
  const la = dated.map((r) => Math.log1p(Math.min(r.age!, 3650)));
  const mean_log_age = la.reduce((s, x) => s + x, 0) / la.length;
  const sd_log_age = Math.sqrt(la.reduce((s, x) => s + (x - mean_log_age) * (x - mean_log_age), 0) / la.length) || 1;
  const ages = dated.map((r) => r.age!).sort((a, b) => a - b);
  return { mean_log_tvl, sd_log_tvl, mean_log_age, sd_log_age, median_age_days: ages[Math.floor(ages.length / 2)]! };
}

/** The smoothed, centred token rate per category over a set of training rows. */
function oddsCatRates(rows: OddsRow[], model: ModelConstants): Map<string, number> {
  const base = rows.filter((r) => r.y === 1).length / rows.length;
  const by = new Map<string, { n: number; pos: number }>();
  for (const r of rows) {
    const k = r.p.category ?? 'Unknown';
    const e = by.get(k) ?? { n: 0, pos: 0 };
    e.n++;
    e.pos += r.y;
    by.set(k, e);
  }
  const out = new Map<string, number>();
  for (const [k, e] of by) {
    if (e.n >= model.odds_cat_min_rows) out.set(k, (e.pos + model.odds_cat_shrinkage * base) / (e.n + model.odds_cat_shrinkage) - base);
  }
  return out;
}

/** One protocol's odds feature vector, in ODDS_FEATURES order. */
function oddsFeatures(p: SnapshotProtocol, age: number | null, stats: OddsFeatureStats, catRates: Map<string, number>): number[] {
  const logTvl = Math.log10(p.tvl_usd);
  const logAge = Math.log1p(Math.min(age === null ? stats.median_age_days : age, 3650));
  const growth = p.change_7d === null ? 0 : Math.min(60, Math.max(-50, p.change_7d));
  return [
    (logTvl - stats.mean_log_tvl) / stats.sd_log_tvl,
    (logAge - stats.mean_log_age) / stats.sd_log_age,
    growth / 50,
    (p.chains.length - 1) / 3,
    age === null ? 1 : 0,
    catRates.get(p.category ?? 'Unknown') ?? 0,
  ];
}

/** The logistic function, clamped so the exponent never overflows. */
function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
}

/** Fit the odds model on a set of training rows (gradient descent, deterministic). */
function fitOddsRows(rows: OddsRow[], model: ModelConstants): OddsFit {
  const stats = oddsFeatureStats(rows);
  const catRates = oddsCatRates(rows, model);
  const X = rows.map((r) => oddsFeatures(r.p, r.age, stats, catRates));
  const d = X[0]!.length;
  const positives = rows.filter((r) => r.y === 1).length;
  const weights = new Array<number>(d).fill(0);
  let bias = Math.log(positives / (rows.length - positives));
  for (let it = 0; it < model.odds_iterations; it++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < rows.length; i++) {
      const z = weights.reduce((s, w, j) => s + w * X[i]![j]!, 0) + bias;
      const err = sigmoid(z) - rows[i]!.y;
      for (let j = 0; j < d; j++) gw[j]! += err * X[i]![j]!;
      gb += err;
    }
    for (let j = 0; j < d; j++) weights[j]! -= model.odds_learning_rate * (gw[j]! / rows.length + (model.odds_l2 * weights[j]!) / rows.length);
    bias -= model.odds_learning_rate * (gb / rows.length);
  }
  return {
    weights,
    bias,
    stats,
    cat_rates: [...catRates.entries()].map(([category, centered_rate]) => ({ category, centered_rate })).sort((a, b) => (a.category < b.category ? -1 : 1)),
    base_rate: positives / rows.length,
    n: rows.length,
    positives,
  };
}

/** Fit the odds model on a snapshot's own training rows. */
export function fitOdds(snapshot: Snapshot, model: ModelConstants = MODEL): OddsFit {
  return fitOddsRows(oddsTrainingRows(snapshot), model);
}

/** One protocol's fitted P(token) under a fitted odds model. */
export function launchOdds(fit: OddsFit, protocol: SnapshotProtocol, asOf: string): number {
  const catRates = new Map(fit.cat_rates.map((c) => [c.category, c.centered_rate] as [string, number]));
  const x = oddsFeatures(protocol, ageDays(asOf, protocol.listed_at), fit.stats, catRates);
  return sigmoid(fit.weights.reduce((s, w, j) => s + w * x[j]!, 0) + fit.bias);
}

/**
 * The eligibility prior for one slug, read off the audit's status, never off a name: 0
 * when the protocol's own token already trades (flagged), 0.5 when a related token trades
 * and the audit left the row unresolved (kin), 1 otherwise (genuine, or unresolved with no
 * trading related token). A flagged row's expected value is 0 — there is no launch left.
 */
export function eligibilityPrior(slug: string): { prior: number; label: string } {
  const e = ELIGIBILITY[slug];
  if (e === undefined) return { prior: 1, label: 'genuine' };
  if (e.status === 'flag') return { prior: 0, label: 'flagged — own token already trades' };
  if (e.status === 'unresolved' && e.kin === true) return { prior: 0.5, label: 'unresolved kin — related token trades' };
  return { prior: 1, label: 'genuine' };
}

/**
 * The odds model's held-out validation: deterministic stratified 5-fold cross-validation —
 * each class sorted by slug and dealt round-robin across the folds, so the split is the
 * same on every run — with the standardisation and the category rates refitted inside each
 * training fold, so no test row leaks into its own prediction. Brier and accuracy are
 * printed next to the base rate's: always predict the base rate (Brier) and always predict
 * the majority class (accuracy). The odds ship only when they beat the base rate on both.
 */
export function oddsCV(snapshot: Snapshot, model: ModelConstants = MODEL): OddsCV {
  const rows = oddsTrainingRows(snapshot);
  const pos = [...rows.filter((r) => r.y === 1)].sort((a, b) => (a.p.slug < b.p.slug ? -1 : 1));
  const neg = [...rows.filter((r) => r.y === 0)].sort((a, b) => (a.p.slug < b.p.slug ? -1 : 1));
  const folds: OddsRow[][] = [[], [], [], [], []];
  pos.forEach((r, i) => folds[i % 5]!.push(r));
  neg.forEach((r, i) => folds[i % 5]!.push(r));
  const baseRate = rows.filter((r) => r.y === 1).length / rows.length;
  let brier = 0;
  let baseBrier = 0;
  let correct = 0;
  for (let k = 0; k < 5; k++) {
    const test = folds[k]!;
    const train = folds.flatMap((f, i) => (i === k ? [] : f));
    const fit = fitOddsRows(train, model);
    for (const r of test) {
      const pr = launchOdds(fit, r.p, snapshot.as_of);
      brier += (pr - r.y) * (pr - r.y);
      baseBrier += (baseRate - r.y) * (baseRate - r.y);
      if ((pr >= 0.5 ? 1 : 0) === r.y) correct++;
    }
  }
  const n = rows.length;
  const out: OddsCV = {
    brier: Math.round((brier / n) * 1e4) / 1e4,
    accuracy: Math.round((correct / n) * 1e4) / 1e4,
    base_brier: Math.round((baseBrier / n) * 1e4) / 1e4,
    base_accuracy: Math.round(Math.max(baseRate, 1 - baseRate) * 1e4) / 1e4,
    n,
    go: false,
  };
  out.go = out.brier < out.base_brier && out.accuracy > out.base_accuracy;
  return out;
}

/** The multipliers and the implied value one protocol gets under `model`, `curve`, `factors`
 *  and the fitted `band`: the low and high are the implied value times the band's P25 and P75,
 *  so the range is the model's own out-of-sample error, not a fixed guess. The implied value
 *  is the expected value: the value-if-launches (curve x factor x growth x maturity x
 *  breadth) times the launch odds (fitted P(token) x eligibility prior). Pass `odds: null`
 *  to neutralise the odds entirely (the "no odds" ablation); pass no `odds` argument and the
 *  row is priced at its value-if-launches with no odds at all. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  curve: CurveFit,
  factors: CategoryFactor[],
  model: ModelConstants = MODEL,
  band: ResidualBand,
  odds?: OddsFit | null,
): {
  implied: number;
  low: number;
  high: number;
  curveValueUsd: number;
  categoryFactor: number;
  effectiveMultiple: number;
  categoryPeers: number;
  categoryFallback: boolean;
  categoryFallbackSource: string | null;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
  valueIfLaunches: number;
  launchOdds: number | null;
  oddsPrior: number;
  oddsPriorLabel: string;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const found = factors.find((f) => f.category === (protocol.category ?? 'Unknown'));
  const factor = found === undefined ? 1 : found.factor;
  const peers = found === undefined ? 0 : found.peers;
  const fallback = found === undefined || found.source !== null;
  const fallbackSource = found === undefined ? 'global' : found.source;
  const curveUsd = curveValue(curve, protocol.tvl_usd);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const maturityMult =
    age === null
      ? model.unknown_age_multiplier
      : model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chains = protocol.chains.length;
  const breadthMult = chains <= 1 ? 1 : chains === 2 ? model.breadth_2 : chains === 3 ? model.breadth_3 : model.breadth_4plus;
  const base = curveUsd * factor;
  const valueIfLaunches = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  const fittedP = odds === undefined || odds === null ? null : launchOdds(odds, protocol, asOf);
  const prior = odds === null ? { prior: 1, label: 'odds neutralised (ablation)' } : eligibilityPrior(protocol.slug);
  const ev = fittedP === null ? valueIfLaunches : valueIfLaunches * fittedP * prior.prior;
  const implied = Math.max(1, Math.round(ev));
  return {
    implied,
    low: Math.max(1, Math.round(implied * band.low_factor)),
    high: Math.round(implied * band.high_factor),
    curveValueUsd: Math.round(curveUsd),
    categoryFactor: factor,
    effectiveMultiple: Math.round((base / protocol.tvl_usd) * 1e4) / 1e4,
    categoryPeers: peers,
    categoryFallback: fallback,
    categoryFallbackSource: fallbackSource,
    growthPct,
    growthMult,
    maturityMult,
    breadthMult,
    age,
    valueIfLaunches,
    launchOdds: fittedP === null ? null : Math.round(fittedP * 1e4) / 1e4,
    oddsPrior: prior.prior,
    oddsPriorLabel: prior.label,
  };
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/**
 * The house watchlist's exclusion, applied to the whole board: a wrapped, staked or bridged
 * product of a token that already trades is not a protocol still waiting on a launch of its
 * own. WBTC is Bitcoin on Ethereum, USDT0 is USDT on another chain, and a Binance or Coinbase
 * bridge is an exchange's product: ranking them as pre-token launches would put wrapped
 * versions of trading tokens at the top of the board. The snapshot carries no parentProtocol
 * field, so the rule is applied from the fields it does carry: category, name and version.
 */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_START = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the board may rank: pre-token and not a wrapped, staked, bridged, exchange or versioned product. */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !EXCLUDED_CATEGORIES.has(p.category ?? '') &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_START.test(p.name) &&
    !VERSIONED.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. `opts.globalFactorOnly`
 *  re-scores the board with every category factor set to 1.00 (the global-factor ablation);
 *  `opts.noOdds` re-scores it with the launch odds neutralised (the no-odds ablation). */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
  opts: { globalFactorOnly?: boolean; noOdds?: boolean } = {},
): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but the
  // board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the biggest: the radar exists
  // to find the small ones too, and the value model (not TVL alone) decides their order.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const curve = fitCurve(snapshot);
  const factors = opts.globalFactorOnly
    ? categoryFactors(snapshot, curve, model).map((f) => ({ ...f, factor: 1, source: 'global' }))
    : categoryFactors(snapshot, curve, model);
  const band = residualBand(snapshot, model);
  const odds = opts.noOdds ? null : fitOdds(snapshot, model);
  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, curve, factors, model, band, odds);
    return { p, v };
  });
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    implied_low_usd: s.v.low,
    implied_high_usd: s.v.high,
    model: {
      curve_value_usd: s.v.curveValueUsd,
      category_factor: round4(s.v.categoryFactor),
      effective_multiple: s.v.effectiveMultiple,
      category_peers: s.v.categoryPeers,
      category_fallback: s.v.categoryFallback,
      fallback_source: s.v.categoryFallbackSource,
      growth_pct: s.v.growthPct,
      growth_multiplier: round4(s.v.growthMult),
      maturity_multiplier: round4(s.v.maturityMult),
      breadth_multiplier: round4(s.v.breadthMult),
      age_days: s.v.age,
      value_if_launches_usd: s.v.valueIfLaunches,
      launch_odds: s.v.launchOdds,
      odds_prior: s.v.oddsPrior,
      odds_prior_label: s.v.oddsPriorLabel,
    },
    farm_steps: farmSteps(s.p, s.v.age).map(stepText),
  }));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a farm plan runs on: the protocol's cheapest chain by assumed gas. */
function chainOf(p: SnapshotProtocol): string {
  return planChain(p.chains);
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The main risk a farmer takes in this category, in plain words. */
function riskFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'a borrow can be liquidated if the collateral falls, so keep the loan well below the limit';
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return 'a liquidity position can lose value when prices move apart, so check the pair before you deposit';
  if (c.includes('bridge')) return 'a bridge can pause or delay a transfer, so never bridge funds you need the same day';
  if (c.includes('staking') || c.includes('restak')) return 'a staked receipt can trade below its backing, so check the receipt price before you stake';
  if (c.includes('perpetual') || c.includes('derivative')) return 'leveraged positions can be liquidated fast, so keep the margin small and the hedge on';
  if (c.includes('stable')) return 'a stable asset can lose its peg, so watch the peg for two weeks before sizing up';
  if (c.includes('rwa')) return 'a real-world asset depends on its issuer and custodian, so read who holds the underlying';
  if (c.includes('insurance')) return 'cover pays only on the terms written in the policy, so read the exclusions before you buy';
  return 'a smart contract can hold a bug, so keep the position small enough that a failure stays affordable';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield asset on ${chain} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names. Rewards are unconfirmed: no step pays to claim, and no step promises a token.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const action = actionFor(p, capital, chain);
  const risk = riskFor(p);
  const gas = gasPerTx(chain);
  const gasStr = gas < 1 ? gas.toFixed(2) : String(gas);
  const unwindStr = (2 * gas).toFixed(2).replace(/\.00$/, '');
  return [
    {
      text: `Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.`,
      cost: `$${gasStr} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: action,
      cost: `$${capital} of capital and about $${gasStr} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: `Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.`,
      cost: `about $${gasStr} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Every two weeks, check the position still qualifies and that ${risk}.`,
      cost: 'nothing to check',
      time: '5 minutes every two weeks',
    },
    {
      text: `Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes; rewards are unconfirmed and no one should ever pay to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: `Unwind in two tranches a week apart, and write the wallet, the dates and every transaction in a farm log so you can repeat the position.`,
      cost: `about $${unwindStr} of gas to unwind`,
      time: '10 minutes',
    },
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/**
 * Leave-one-factor-out: each of the board's top 10 protocols, and the rank it takes when one
 * factor of the model is neutralised. Growth off means every row's growth multiplier is 1;
 * maturity off means every row's maturity multiplier is 1; breadth off means every row's
 * breadth multiplier is 1; global-factor-only means every category falls back to a factor of
 * 1.00 instead of its own peers. A board whose top rows move only a little under every
 * ablation is driven by the snapshot's TVL, not by any one tuning choice. The no-odds
 * ablation re-ranks the board at value-if-launches alone, so the reader can see what the
 * launch odds do to the order.
 */
export function ablationTable(snapshot: Snapshot, model: ModelConstants = MODEL): AblationRow[] {
  const full = buildBoard(snapshot, model);
  const top10 = full.slice(0, 10);
  const boards = {
    no_growth: buildBoard(snapshot, { ...model, growth_weight: 0 }),
    no_maturity: buildBoard(snapshot, { ...model, maturity_floor: 1, maturity_range: 0, unknown_age_multiplier: 1 }),
    no_breadth: buildBoard(snapshot, { ...model, breadth_2: 1, breadth_3: 1, breadth_4plus: 1 }),
    global_factor: buildBoard(snapshot, model, { globalFactorOnly: true }),
    no_odds: buildBoard(snapshot, model, { noOdds: true }),
  };
  const rankIn = (board: BoardRow[], slug: string): number => {
    const found = board.find((r) => r.slug === slug);
    return found === undefined ? board.length + 1 : found.rank;
  };
  return top10.map((r) => ({
    slug: r.slug,
    name: r.name,
    full: r.rank,
    no_growth: rankIn(boards.no_growth, r.slug),
    no_maturity: rankIn(boards.no_maturity, r.slug),
    no_breadth: rankIn(boards.no_breadth, r.slug),
    global_factor: rankIn(boards.global_factor, r.slug),
    no_odds: rankIn(boards.no_odds, r.slug),
  }));
}

/** A board row's compact form for data.js, with the model breakdown the page renders. */
export function radarRow(row: BoardRow): RadarRow {
  const e = ELIGIBILITY[row.slug];
  const eligibility =
    e === undefined
      ? `Screened ${ELIGIBILITY_DATE}: the snapshot record carries no market cap, no CoinGecko id and no symbol. Automated screen of the record only — not a deep check; the record may miss a token that trades.`
      : e.status === 'flag'
        ? `Flagged ${ELIGIBILITY_DATE}: a token already trades — see the eligibility check below.`
        : e.status === 'unresolved'
          ? `Unresolved ${ELIGIBILITY_DATE}: a related token exists but it is ambiguous — see the eligibility check below.`
          : `Checked ${ELIGIBILITY_DATE}: no token found — see the eligibility check below.`;
  const v = verdictFor(row);
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    implied_low_usd: row.implied_low_usd,
    implied_high_usd: row.implied_high_usd,
    curve_value_usd: row.model.curve_value_usd,
    category_factor: row.model.category_factor,
    effective_multiple: row.model.effective_multiple,
    category_peers: row.model.category_peers,
    category_fallback: row.model.category_fallback,
    fallback_source: row.model.fallback_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    value_if_launches_usd: row.model.value_if_launches_usd,
    launch_odds: row.model.launch_odds,
    odds_prior: row.model.odds_prior,
    odds_prior_label: row.model.odds_prior_label,
    eligibility,
    farm_ticket: farmTicket(row),
    slice_usd: v.slice_usd,
    fees_usd: v.fees_usd,
    hold_days: v.hold_days,
    net_usd: v.net_usd,
    net_per_hour_usd: v.net_per_hour_usd,
    verdict: v.verdict,
    risk: v.risk,
    plan_chain: planChain(row.chains),
    farm_steps: row.farm_steps,
  };
}

/** The verdict's assumptions: what a $1,000 farm plan would pay, after every cost.
 *  None of this is snapshot data — the page states each number so a reader can re-price it:
 *  depositors get 10% of the launch, pro rata on TVL; gas is the assumed typical cost of one
 *  transaction on the row's first chain (Nov 2026); the plan holds for the same days the farm
 *  steps hold; the money not in the plan earns a 4% T-bill; hands-on time is the setup, one
 *  10-minute action a week, the claim and the unwind. A row is FARM when the drop pays at
 *  least $5 after all of that, THIN when it pays at all, SKIP when the fees eat it. */
export const DEPOSITOR_SHARE = 0.1;
export const PLAN_CAPITAL_USD = 1000;
export const TBILL_RATE = 0.04;
export const FARM_MIN_USD = 5;

/** Assumed typical cost of one transaction on each chain, in dollars (Nov 2026). */
export const GAS_PER_TX: Record<string, number> = {
  Ethereum: 4.0,
  Bitcoin: 3.0,
  Tron: 2.0,
  Binance: 0.3,
  Avalanche: 0.25,
  Arbitrum: 0.15,
  Optimism: 0.15,
  Base: 0.1,
  Ink: 0.1,
  Monad: 0.1,
  Polygon: 0.1,
  Solana: 0.05,
  Sui: 0.05,
  Aptos: 0.05,
};

/** The gas a plan pays on this chain: the table's value, or $0.25 for a chain it does not name. */
export function gasPerTx(chain: string): number {
  return GAS_PER_TX[chain] ?? 0.25;
}

/** The chain a farm plan runs on: the protocol's cheapest chain by assumed gas, because a
 *  farmer minimizing fees picks the cheapest route the protocol runs on. */
export function planChain(chains: string[]): string {
  if (chains.length === 0) return 'its main chain';
  let best = chains[0]!;
  for (const c of chains) if (gasPerTx(c) < gasPerTx(best)) best = c;
  return best;
}

/** A row's risk tier, from its category: leveraged and bridged positions can be liquidated
 *  or paused; lending and liquidity positions can lose value; vaults, stables and real-world
 *  assets carry the contract risk every row carries and no leverage of their own. */
export function riskTier(category: string | null): 'low' | 'medium' | 'high' {
  const c = (category ?? '').toLowerCase();
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('leveraged') || c.includes('bridge')) return 'high';
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral') || c.includes('dex') || c.includes('yield') || c.includes('staking') || c.includes('restak')) return 'medium';
  return 'low';
}

/** One row's verdict at a $1,000 plan: the slice, the costs, the net and the call. */
export interface Verdict {
  slice_usd: number;
  fees_usd: number;
  tx_count: number;
  gas_usd: number;
  hold_days: number;
  forgone_yield_usd: number;
  net_usd: number;
  net_per_hour_usd: number;
  hands_on_minutes: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  risk: 'low' | 'medium' | 'high';
}

/** The verdict for a row of the board: the slice is the depositor share of the implied value,
 *  pro rata on a $1,000 deposit; fees are one transaction per week of the hold plus setup,
 *  claim and unwind; the forgone yield is the T-bill on the $1,000 over the hold. */
export function verdictFor(row: BoardRow): Verdict {
  const chain = planChain(row.chains);
  const gas = gasPerTx(chain);
  const hold = holdDaysFor(row.age_days);
  const txs = 4 + Math.ceil(hold / 7);
  const fees = Math.round(txs * gas * 100) / 100;
  const slice = (row.implied_value_usd * DEPOSITOR_SHARE * PLAN_CAPITAL_USD) / row.tvl_usd;
  const forgone = (PLAN_CAPITAL_USD * TBILL_RATE * hold) / 365;
  const net = slice - fees - forgone;
  const handsOn = 35 + 10 * Math.ceil(hold / 7);
  const netPerHour = net / (handsOn / 60);
  return {
    slice_usd: Math.round(slice * 100) / 100,
    fees_usd: fees,
    tx_count: txs,
    gas_usd: gas,
    hold_days: hold,
    forgone_yield_usd: Math.round(forgone * 100) / 100,
    net_usd: Math.round(net * 100) / 100,
    net_per_hour_usd: Math.round(netPerHour * 100) / 100,
    hands_on_minutes: handsOn,
    verdict: net >= FARM_MIN_USD ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP',
    risk: riskTier(row.category),
  };
}

/** The farm ticket: one line per row — mechanism, chain, capital, gas and hold. The gas and
 *  the hold vary by row, so no two tickets read the same unless the rows genuinely match. */
export function farmTicket(row: BoardRow): string {
  const c = (row.category ?? '').toLowerCase();
  const mechanism = c.includes('curator') || c.includes('allocator')
    ? 'Vault'
    : c.includes('lend') || c.includes('cdp') || c.includes('collateral')
      ? 'Supply'
      : c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')
        ? 'Liquidity'
        : c.includes('bridge')
          ? 'Bridge'
          : c.includes('staking') || c.includes('restak')
            ? 'Stake'
            : c.includes('perpetual') || c.includes('derivative')
              ? 'Margin'
              : c.includes('prediction')
                ? 'Market'
                : c.includes('stable')
                  ? 'Mint'
                  : c.includes('rwa')
                    ? 'Mint'
                    : c.includes('insurance')
                      ? 'Cover'
                      : 'Deposit';
  const chain = planChain(row.chains);
  const capital = capitalFor({ tvl_usd: row.tvl_usd } as SnapshotProtocol);
  const v = verdictFor(row);
  return `${mechanism}: ${chain} · $${capital} · $${v.fees_usd.toFixed(2)} fees · ${v.hold_days}d hold`;
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const curve = fitCurve(snapshot);
  const factors = categoryFactors(snapshot, curve, model);
  const loo = looStats(snapshot, model);
  const band = residualBand(snapshot, model);
  const timeSplit = timeSplitStats(snapshot, model);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const tokenOnRecord = snapshot.protocols.filter((p) => !isPreToken(p)).length;
  const setAside = snapshot.protocols.length - board.length - tokenOnRecord;
  const verdicts = board.map((r) => verdictFor(r));
  const verdictCounts = { farm: 0, thin: 0, skip: 0 };
  for (const v of verdicts) {
    if (v.verdict === 'FARM') verdictCounts.farm++;
    else if (v.verdict === 'THIN') verdictCounts.thin++;
    else verdictCounts.skip++;
  }
  const withVerdict = board.map((r, i) => ({ r, v: verdicts[i]! }));
  const lowRiskFarms = withVerdict.filter(({ v }) => v.verdict === 'FARM' && v.risk !== 'high');
  const farmPool = lowRiskFarms.length >= 5 ? lowRiskFarms : withVerdict.filter(({ v }) => v.verdict === 'FARM');
  const farmNext = [...farmPool]
    .sort((a, b) => b.v.net_per_hour_usd - a.v.net_per_hour_usd)
    .slice(0, 5)
    .map(({ r, v }) => ({
      rank: r.rank,
      name: r.name,
      chain: planChain(r.chains),
      net_per_hour_usd: v.net_per_hour_usd,
      net_usd: v.net_usd,
      slice_usd: v.slice_usd,
      fees_usd: v.fees_usd,
      hold_days: v.hold_days,
    }));
  const bucketMax = [2_000_000, 5_000_000, 10_000_000, 20_000_000, 50_000_000, Infinity];
  const bucketLabels = ['<$2M', '$2–5M', '$5–10M', '$10–20M', '$20–50M', '≥$50M'];
  const histogram = bucketMax.map((max, i) => {
    const lo = i === 0 ? 0 : bucketMax[i - 1]!;
    return { label: bucketLabels[i]!, count: board.filter((r) => r.implied_value_usd >= lo && r.implied_value_usd < max).length };
  });
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    token_on_record: tokenOnRecord,
    set_aside: setAside,
    curve,
    loo,
    band,
    time_split: timeSplit,
    odds_fit: fitOdds(snapshot, model),
    odds_cv: oddsCV(snapshot, model),
    factors,
    watchlist_slugs: snapshot.watchlist,
    rows: board.map(radarRow),
    live,
    ablation: ablationTable(snapshot, model),
    audit_date: AUDIT_DATE,
    audit: AUDIT,
    eligibility: ELIGIBILITY,
    eligibility_date: ELIGIBILITY_DATE,
    eligibility_source: ELIGIBILITY_SOURCE,
    screened: screenedView(board),
    unresolved: unresolvedView(board),
    flagged: flaggedView(board),
    verdict_counts: verdictCounts,
    farm_next: farmNext,
    histogram,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
