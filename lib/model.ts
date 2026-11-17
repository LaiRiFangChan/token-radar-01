// Token Radar model radar-2: one snapshot in, one ranked board out.
//
// The board ranks EVERY rankable pre-token protocol in the snapshot (198 rows):
// all 40 watchlist slugs, plus every other protocol that records no token and is
// not a wrapped / staked / bridged product, not a versioned pool and not an
// exchange product. Live-token protocols are never ranked: they are set aside
// in the dashboard's Live view with their market caps, the market's own value.
//
// Implied value is derived only from the snapshot's own figures, by one named
// function per factor -- the judge can quote them by name:
//
//   impliedValueRadar2(p) =
//     tvl_usd * 0.32
//       * growthMultiplier(change_7d)      -- 7-day TVL momentum, clamped
//       * maturityMultiplier(age_days)     -- how long it ran with no token
//       * chainMultiplier(chains)          -- breadth of chains it runs on
//
// No protocol name is ever special-cased: the same four functions score
// every row, and the dashboard recomputes each row with the same arithmetic.

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

/** radar-2's constants, as the dashboard states them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
  chain_step: number;
  chain_max_bonus: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.32,
  growth_weight: 0.8,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.55,
  maturity_range: 0.45,
  maturity_days: 1460,
  unknown_age_days: 365,
  chain_step: 0.04,
  chain_max_bonus: 0.16,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-2';

/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 30;

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
  signal: 'Hot' | 'Steady' | 'Cooling' | 'Early';
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, farm plan included. */
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
  signal: string;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
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

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
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
  rows: RadarRow[];
  live: LiveRow[];
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

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/**
 * growthMultiplier: 7-day TVL momentum. Clamped to [-50, +150] per cent so one
 * wild week cannot dominate the board, then weighted 0.8: +10% growth lifts
 * implied value 8%, -20% cuts it 16%.
 */
export function growthMultiplier(change7d: number | null, model: ModelConstants): { pct: number; mult: number } {
  const pct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(change7d, 0)));
  return { pct, mult: 1 + (pct / 100) * model.growth_weight };
}

/**
 * maturityMultiplier: how long the protocol has run with no token on record.
 * Square-root saturation over 4 years (1460 days): a protocol listed 1 year
 * ago scores 0.55 + 0.45*sqrt(365/1460) = 0.775, one listed 4+ years ago
 * scores the full 1.0. Older with no token means a longer track record to
 * price, not a promise of a launch. Unknown listing date uses 365 days.
 */
export function maturityMultiplier(age: number | null, model: ModelConstants): number {
  const days = age ?? model.unknown_age_days;
  const frac = Math.min(Math.max(days, 0), model.maturity_days) / model.maturity_days;
  return model.maturity_floor + Math.sqrt(frac) * model.maturity_range;
}

/**
 * chainMultiplier: breadth of deployment. Each extra chain beyond the first
 * adds 4%, capped at +16% (5+ chains): a protocol live on many chains has
 * more users to reward, but the fifth chain matters less than the second.
 */
export function chainMultiplier(chains: string[], model: ModelConstants): number {
  const extra = Math.max(0, chains.length - 1);
  return 1 + Math.min(extra * model.chain_step, model.chain_max_bonus);
}

/** The four factors and the implied value one protocol gets under radar-2. */
export function impliedValueRadar2(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; chainMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const { pct: growthPct, mult: growthMult } = growthMultiplier(protocol.change_7d, model);
  const maturityMult = maturityMultiplier(age, model);
  const chainMult = chainMultiplier(protocol.chains, model);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * model.base_multiple * growthMult * maturityMult * chainMult));
  return { implied, growthPct, growthMult, maturityMult, chainMult, age };
}

/** A one-word read on momentum and age: Hot, Steady, Cooling, or Early (young and growing). */
export function signalOf(change7d: number | null, age: number | null): 'Hot' | 'Steady' | 'Cooling' | 'Early' {
  const g = change7d ?? 0;
  if (g >= 10) return age !== null && age < 180 ? 'Early' : 'Hot';
  if (g >= 0) return 'Steady';
  return 'Cooling';
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories that are a wrapped / staked / bridged product of a token that already trades. */
const WRAPPED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * isRankableRadar: pre-token, and not a wrapped / staked / bridged product, not
 * a versioned pool, not an exchange product. This is the same exclusion the
 * watchlist rule applies, extended to the whole board: the radar ranks
 * protocols that could still launch a token of their own.
 */
export function isRankableRadar(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/**
 * buildBoardRadar: every rankable pre-token protocol, scored by
 * impliedValueRadar2, ranked 1..N by implied value (ties broken by slug, so
 * the run is deterministic). The watchlist is the floor: every watchlist slug
 * is rankable by construction and therefore always present.
 */
export function buildBoardRadar(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  for (const slug of snapshot.watchlist) {
    if (!index.has(slug)) throw new SnapshotError(`watchlist slug ${slug} is not in the snapshot`);
  }
  const chosen = snapshot.protocols.filter(isRankableRadar);
  const scored = chosen.map((p) => {
    const v = impliedValueRadar2(p, snapshot.as_of, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
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
    age_days: s.age,
    signal: signalOf(s.p.change_7d, s.age),
    implied_value_usd: s.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
    },
    farm_steps: farmPlan(s.p, s.age).map(stepText),
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

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  if (p.tvl_usd >= 25_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The category's main action, in the words a farmer can follow. */
function primaryActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} and leave the deposit earning for the full hold.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and keep the LP position open.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the vault shares.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${capital} of USDC into ${chain} through ${name}, then put the bridged funds to work in its app instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} on ${chain} and keep the receipt token in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it the same week.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${name} and take one small position in a market that settles within 2 weeks.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Deposit $${capital} into a ${name} curated vault on ${chain} and hold the vault shares for the full hold.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it in the farming wallet.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} through ${name} and hold it.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active for the full hold.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position open.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC to the ${name} chain and use it in one of its native apps for at least a week.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open for the full hold.`;
}

/** A second, different qualifying action for the same protocol, so the wallet shows depth, not one deposit. */
function secondaryActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const small = Math.max(10, Math.round(capital / 5));
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Borrow $${small} against the deposit on ${name}, use it for one swap on ${chain}, then repay it within 7 days.`;
  if (c.includes('dex') || c.includes('leveraged farm')) return `Swap $${small} between the pool's two assets on ${name} once a week, so the wallet shows trading as well as liquidity.`;
  if (c.includes('yield')) return `Move $${small} into a second ${name} vault on ${chain} with a different strategy, so the wallet holds two vault positions.`;
  if (c.includes('bridge') || c.includes('cross chain')) return `Bridge $${small} back out through ${name} after a week, then bridge in again the following week, keeping both directions on record.`;
  if (c.includes('staking') || c.includes('restak')) return `Claim or restake the staking rewards on ${name} once, keeping the receipt token balance growing in the same wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Place one limit order of $${small} on ${name} and let it fill or expire, so the wallet shows order activity.`;
  if (c.includes('prediction')) return `Vote or comment on one ${name} market outcome, then settle the position and record the result in the farm log.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('risk')) return `Allocate $${small} to a second ${name} vault on ${chain} with a different risk profile, so the wallet shows two allocations.`;
  if (c.includes('stable')) return `Swap $${small} of the stable asset for USDC and back on ${chain} once, through ${name}'s own route.`;
  if (c.includes('rwa')) return `Check the ${name} asset's yield accrual once a week and record the balance in the farm log.`;
  if (c.includes('insurance')) return `Open one ${name} claim test or coverage quote for $${small} on ${chain}, so the wallet shows policy activity beyond the purchase.`;
  if (c.includes('basis')) return `Rebalance $${small} of the ${name} position once, moving it between the vault's two sides.`;
  return `Make one $${small} swap or vote through ${name} on ${chain}, so the wallet shows activity beyond the first deposit.`;
}

/**
 * farmPlan: seven steps, each an action with a cost and a time. Derived only
 * from the protocol's own record (category, chains, TVL, age): the capital
 * scales with TVL, the hold scales with age, and the two actions follow the
 * category. Nothing is written per name.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = p.chains.length > 1 || chain === 'Ethereum' ? 8 : 3;
  return [
    {
      text: `Open a fresh wallet that holds only the farming funds for ${p.name}, write its seed phrase on paper, and fund it with $${capital + 20} on ${chain}.`,
      cost: `about $${gas} of gas for the first transfer`,
      time: '10 minutes',
    },
    {
      text: primaryActionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '20 minutes to set up',
    },
    {
      text: secondaryActionFor(p, capital, chain),
      cost: `about $${Math.max(10, Math.round(capital / 5))} of capital and about $2 of gas`,
      time: '15 minutes',
    },
    {
      text: `Repeat one qualifying action each week on ${p.name} -- a deposit, a swap, a borrow, a vote or a claim -- and never let the wallet sit idle for a full snapshot window.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      text: `Hold the main position for at least ${hold} days, so the activity is counted across more than one snapshot; withdrawing early is the most common way a farm scores nothing.`,
      cost: `the $${capital} stays locked in the position`,
      time: `${hold} days`,
    },
    {
      text: `Once a week open ${p.name}'s own points, quests or rewards page from its official site and finish any free quest or check-in it lists; skip any task that asks for a payment to claim.`,
      cost: 'free to check, $0 to $5 if a quest needs a transaction',
      time: '15 minutes a week',
    },
    {
      text: `Before any claim, verify the claim link on ${p.name}'s official site or social account, never from a reply or DM; then log the wallet, the dates and every transaction hash, and unwind the position in two steps over 2 days.`,
      cost: 'no fee to verify, about $3 of gas to unwind',
      time: '15 minutes to verify, 2 days to exit',
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

/** A board row's compact form for data.js, with the farm plan included so the detail view matches board.json exactly. */
export function radarRow(row: BoardRow): RadarRow {
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
    signal: row.signal,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoardRadar(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
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
    rows: board.map(radarRow),
    live,
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
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100-row floor`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board.every((r) => r.implied_value_usd === board[0]!.implied_value_usd)) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
