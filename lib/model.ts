// Token Radar — value model and farm-plan generator.
//
// The board ranks pre-token protocols by an implied value that comes only from
// the sealed snapshot's own figures. Nothing is special-cased by name: every
// protocol is scored by the same four steps.
//
//   1. Comparable multiple. For each category, look at the protocols whose
//      token already trades and take the median of (market cap / TVL). That is
//      the market's own price for one dollar of locked value in that line of
//      business. A category with no live comparables falls back to the global
//      median. The multiple is clamped to [0.05, 1.50] so one outlier category
//      cannot run away with the board.
//   2. Growth. The protocol's 7-day TVL change, clamped to [-40, +100] per
//      cent, moves the value by 0.7x its size: a protocol gaining TVL fast is
//      worth more than a flat one of the same size.
//   3. Tenure. How long the protocol has run with no token, from listed_at:
//      0.75 for a brand-new listing rising to 1.20 after four years. A long
//      tokenless record is accumulated, un-monetised value; an unknown listing
//      date scores 0.90.
//   4. implied = round(TVL x multiple x growthMult x tenureMult), at least $1.
//
// Live-token protocols are never ranked: they already trade, so the dashboard
// shows their market cap as the market's own value, in a separate view.

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

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-2-comparables';

/** How many pre-token protocols below the watchlist floor the early radar carries. */
export const EARLY_ROWS = 260;
/** How many live-token protocols the Live view carries, by market cap. */
export const LIVE_ROWS = 24;

export interface ModelConstants {
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_top: number;
  tenure_days: number;
  unknown_tenure: number;
}

export const MODEL: ModelConstants = {
  multiple_floor: 0.05,
  multiple_cap: 1.5,
  growth_weight: 0.7,
  growth_floor: -40,
  growth_cap: 100,
  tenure_floor: 0.75,
  tenure_top: 1.2,
  tenure_days: 1460,
  unknown_tenure: 0.9,
};

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole days from listed_at to as_of; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** A protocol records no token when the snapshot carries no market cap, id or symbol for it. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Rankable: pre-token, not a centralised exchange, not a versioned pool of another protocol. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

export interface CategoryMultiple {
  category: string;
  multiple: number;
  comparables: number;
}

/**
 * The market's own price per dollar of TVL, per category: the median
 * (market cap / TVL) of the live-token protocols in that category. Categories
 * with fewer than 3 live comparables fall back to the global median.
 */
export function categoryMultiples(snapshot: Snapshot, model: ModelConstants): { byCategory: Map<string, CategoryMultiple>; global: number } {
  const live = snapshot.protocols.filter((p) => !isPreToken(p) && p.tvl_usd > 0 && (p.mcap_usd ?? 0) > 0);
  const clamp = (m: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
  const global = clamp(median(live.map((p) => p.mcap_usd! / p.tvl_usd)));
  const byCategory = new Map<string, CategoryMultiple>();
  const cats = new Set(live.map((p) => p.category ?? 'Uncategorised'));
  for (const cat of cats) {
    const ratios = live.filter((p) => (p.category ?? 'Uncategorised') === cat).map((p) => p.mcap_usd! / p.tvl_usd);
    byCategory.set(cat, {
      category: cat,
      multiple: ratios.length >= 3 ? clamp(median(ratios)) : global,
      comparables: ratios.length,
    });
  }
  return { byCategory, global };
}

export interface Valuation {
  implied: number;
  multiple: number;
  multipleSource: string;
  growthPct: number;
  growthMult: number;
  tenureMult: number;
  age: number | null;
}

/** One protocol's implied value under the model, with the full breakdown. */
export function valueProtocol(
  p: SnapshotProtocol,
  asOf: string,
  multiples: { byCategory: Map<string, CategoryMultiple>; global: number },
  model: ModelConstants,
): Valuation {
  const cat = p.category ?? 'Uncategorised';
  const entry = multiples.byCategory.get(cat);
  const multiple = entry !== undefined ? entry.multiple : multiples.global;
  const multipleSource = entry !== undefined && entry.comparables >= 3
    ? `median mcap/TVL of ${entry.comparables} live ${cat} protocols`
    : 'global median mcap/TVL (too few live comparables in this category)';
  const rawGrowth = finite(p.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const age = ageDays(asOf, p.listed_at);
  const tenureMult = age === null
    ? model.unknown_tenure
    : model.tenure_floor + (Math.min(age, model.tenure_days) / model.tenure_days) * (model.tenure_top - model.tenure_floor);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthMult * tenureMult));
  return { implied, multiple, multipleSource, growthPct, growthMult, tenureMult, age };
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    multiple: number;
    multiple_source: string;
    growth_pct: number;
    growth_multiplier: number;
    tenure_multiplier: number;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  multiple: number;
  multiple_source: string;
  growth_multiplier: number;
  tenure_multiplier: number;
  farm_steps: string[];
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  global_multiple: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  multiples: CategoryMultiple[];
  rows: RadarRow[];
  live: LiveRow[];
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Build the ranked board: every watchlist slug, plus the early pre-token rows. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; multiples: { byCategory: Map<string, CategoryMultiple>; global: number } } {
  const multiples = categoryMultiples(snapshot, model);
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => ({ p, v: valueProtocol(p, snapshot.as_of, multiples, model) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    token_status: 'pre-token',
    age_days: s.v.age,
    implied_value_usd: s.v.implied,
    model: {
      multiple: round4(s.v.multiple),
      multiple_source: s.v.multipleSource,
      growth_pct: round4(s.v.growthPct),
      growth_multiplier: round4(s.v.growthMult),
      tenure_multiplier: round4(s.v.tenureMult),
    },
    farm_steps: farmSteps(s.p, s.v.age),
  }));
  return { board, multiples };
}

/** Live-token protocols by market cap, for the dashboard's separate Live view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d }));
}

export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, multiples } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    global_multiple: round4(multiples.global),
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    multiples: [...multiples.byCategory.values()].sort((a, b) => b.multiple - a.multiple),
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      multiple: r.model.multiple,
      multiple_source: r.model.multiple_source,
      growth_multiplier: r.model.growth_multiplier,
      tenure_multiplier: r.model.tenure_multiplier,
      farm_steps: r.farm_steps,
    })),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- farm plans

interface Step {
  action: string;
  cost: string;
  time: string;
}

function stepText(s: Step): string {
  let out = `${s.action} Cost: ${s.cost}. Time: ${s.time}.`;
  if (out.length > 600) out = `${out.slice(0, 596)}...`;
  if (out.length < 20) out = `${out} Keep a written log of the wallet, dates and transactions.`;
  return out;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${n} on ${chain} as a lender and leave the deposit earning.`;
  if (c.includes('dex')) return `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain} and keep the position in range.`;
  if (c.includes('yield aggregator') || c.includes('yield')) return `Deposit $${capital} of USDC into ${n}'s highest-yield vault on ${chain} and leave the shares compounding.`;
  if (c.includes('leveraged farm')) return `Open a $${capital} leveraged farming position on ${n} on ${chain} at low leverage and monitor the health factor weekly.`;
  if (c.includes('bridge') || c.includes('canonical')) return `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds inside its app instead of bridging straight back.`;
  if (c.includes('liquid staking') || c.includes('restak')) return `Stake $${capital} of the chain's native asset through ${n} on ${chain} and hold the receipt token.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged trade.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} on ${chain} and take one position in a market that settles within the month.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${n} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold it in the protocol.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it to maturity.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active.`;
  if (c.includes('synthetic')) return `Mint $${capital} of synthetic assets on ${n} on ${chain} and keep the position collateralised.`;
  if (c.includes('options')) return `Deposit $${capital} of USDC into an ${n} options vault on ${chain} and hold the shares through one expiry.`;
  if (c.includes('privacy')) return `Deposit $${capital} through ${n} on ${chain} and use its private transfer feature once a week.`;
  if (c.includes('launchpad')) return `Stake $${capital} of the chain's asset in ${n}'s launch pool on ${chain} and join one sale.`;
  if (c.includes('gaming') || c.includes('nft')) return `Buy $${capital} of in-app assets on ${n} on ${chain} and play or hold them for a month.`;
  if (c.includes('wallet') || c.includes('payments')) return `Route $${capital} of payments through ${n} on ${chain} and keep the wallet funded.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

function weeklyAction(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('dex') || c.includes('yield')) return 'a swap, a deposit or a re-balance';
  if (c.includes('lend') || c.includes('cdp')) return 'a supply, a borrow or a repayment';
  if (c.includes('bridge')) return 'a bridge or a swap on the destination chain';
  if (c.includes('staking') || c.includes('restak')) return 'a stake, a restake or a claim';
  if (c.includes('perpetual') || c.includes('derivative')) return 'a trade or a margin top-up';
  return 'a deposit, a swap or a vote';
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time,
 * derived from the protocol's own record (category, chains, TVL, age).
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 8 : 4;
  const steps: Step[] = [
    {
      action: 'Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline on paper.',
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    {
      action: coreAction(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      action: `Do one qualifying action each week, such as ${weeklyAction(p)}, so the wallet shows repeat activity rather than a single deposit.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days so the activity spans more than one snapshot window.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      action: `Before withdrawing anything, open the protocol's own points or rewards page and claim only from the link it publishes there.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      action: 'Write the wallet address, the dates and every transaction hash in a farm log so you can repeat the position or unwind it cleanly.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  ];
  return steps.map(stepText);
}

// ---------------------------------------------------------------- parsing

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
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}`;
  }
  for (const r of board) {
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's dataset as one script: window.RADAR, no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
