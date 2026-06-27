import { DateTime } from "luxon";
import {
  ALL_ASSETS,
  ALL_TIMEFRAMES,
  assetSlug,
  assetTicker,
  type Asset,
  type MarketInfo,
  type PtbVenue,
  type TimeFrame,
} from "./types.js";
import { nowSecs } from "./time.js";

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

function monthName(m: number): string {
  return MONTHS[m - 1] ?? "january";
}

function monthFromName(name: string): number | null {
  const idx = MONTHS.indexOf(name.toLowerCase());
  return idx >= 0 ? idx + 1 : null;
}

function parseHourAmpm(s: string): number | null {
  const lower = s.toLowerCase();
  if (lower.endsWith("am")) {
    const h = parseInt(lower.slice(0, -2), 10);
    return h === 12 ? 0 : h;
  }
  if (lower.endsWith("pm")) {
    const h = parseInt(lower.slice(0, -2), 10);
    return h === 12 ? 12 : h + 12;
  }
  return null;
}

export function build5mSlug(asset: Asset, periodStart: number): string {
  return `${assetTicker(asset)}-updown-5m-${periodStart}`;
}

export function build15mSlug(asset: Asset, periodStart: number): string {
  return `${assetTicker(asset)}-updown-15m-${periodStart}`;
}

export function build1hSlug(asset: Asset, periodStartEt: number): string {
  const dt = DateTime.fromSeconds(periodStartEt, { zone: "America/New_York" });
  const hour24 = dt.hour;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const ampm = hour24 < 12 ? "am" : "pm";
  return `${assetSlug(asset)}-up-or-down-${monthName(dt.month)}-${dt.day}-${dt.year}-${hour12}${ampm}-et`;
}

export function buildSlugFor(asset: Asset, tf: TimeFrame, periodStart: number): string {
  if (tf === "5m") return build5mSlug(asset, periodStart);
  if (tf === "15m") return build15mSlug(asset, periodStart);
  return build1hSlug(asset, periodStart);
}

export function current1hPeriodStartEt(): number {
  const now = DateTime.now().setZone("America/New_York");
  const hourStart = now.startOf("hour");
  return Math.floor(hourStart.toSeconds());
}

export function currentPeriodStart(tf: TimeFrame): number {
  const now = nowSecs();
  if (tf === "5m") return Math.floor(now / 300) * 300;
  if (tf === "15m") return Math.floor(now / 900) * 900;
  return current1hPeriodStartEt();
}

export function ptbVenueForTf(tf: TimeFrame): PtbVenue {
  return tf === "1h" ? "binance" : "chainlink";
}

export function parse1hPeriodStartEt(slug: string): number | null {
  if (!slug.endsWith("-et")) return null;
  const base = slug.slice(0, -3);
  const marker = "-up-or-down-";
  const idx = base.indexOf(marker);
  if (idx < 0) return null;
  const rest = base.slice(idx + marker.length);
  const parts = rest.split("-");
  if (parts.length !== 4) return null;
  const month = monthFromName(parts[0]!);
  const day = parseInt(parts[1]!, 10);
  const year = parseInt(parts[2]!, 10);
  const hour24 = parseHourAmpm(parts[3]!);
  if (!month || !day || !year || hour24 === null) return null;
  const dt = DateTime.fromObject(
    { year, month, day, hour: hour24, minute: 0, second: 0 },
    { zone: "America/New_York" },
  );
  return Math.floor(dt.toSeconds());
}

interface GammaEvent {
  markets?: GammaMarket[];
}

interface GammaMarket {
  conditionId?: string;
  active?: boolean;
  closed?: boolean;
  startPrice?: string;
  outcomes?: string;
  outcomePrices?: string;
  umaResolutionStatus?: string;
}

interface ClobMarket {
  tokens?: ClobToken[];
  active?: boolean;
  closed?: boolean;
}

interface ClobToken {
  outcome: string;
  token_id: string;
}

async function fetchConditionId(
  gammaUrl: string,
  slug: string,
): Promise<{ conditionId: string; startPrice: number } | null> {
  const url = `${gammaUrl.replace(/\/$/, "")}/events/slug/${slug}`;
  const resp = await fetch(url);
  if (resp.status === 404) return null;
  if (!resp.ok) return null;
  const event = (await resp.json()) as GammaEvent;
  for (const m of event.markets ?? []) {
    if (m.active && !m.closed && m.conditionId) {
      const startPrice = m.startPrice ? parseFloat(m.startPrice) : 0;
      return { conditionId: m.conditionId, startPrice };
    }
  }
  return null;
}

async function fetchTokenIds(
  clobUrl: string,
  conditionId: string,
): Promise<[string, string]> {
  const url = `${clobUrl.replace(/\/$/, "")}/markets/${conditionId}`;
  const resp = await fetch(url);
  if (!resp.ok) return ["", ""];
  const m = (await resp.json()) as ClobMarket;
  if (!m.active || m.closed) return ["", ""];
  let yes = "";
  let no = "";
  for (const t of m.tokens ?? []) {
    const o = t.outcome.toUpperCase();
    if ((o === "UP" || o === "YES" || o === "1") && !yes) yes = t.token_id;
    if ((o === "DOWN" || o === "NO" || o === "0") && !no) no = t.token_id;
  }
  return [yes, no];
}

export async function resolveMarket(
  gammaUrl: string,
  clobUrl: string,
  asset: Asset,
  tf: TimeFrame,
  periodStart: number,
): Promise<MarketInfo> {
  const slug = buildSlugFor(asset, tf, periodStart);
  const gamma = await fetchConditionId(gammaUrl, slug);
  if (!gamma) {
    return {
      asset,
      tf,
      period_start_unix: periodStart,
      slug,
      condition_id: "",
      yes_token_id: "",
      no_token_id: "",
      price_to_beat: 0,
      ptb_venue: ptbVenueForTf(tf),
      resolved: false,
      unavailable: true,
    };
  }
  const [yes, no] = await fetchTokenIds(clobUrl, gamma.conditionId);
  return {
    asset,
    tf,
    period_start_unix: periodStart,
    slug,
    condition_id: gamma.conditionId,
    yes_token_id: yes,
    no_token_id: no,
    price_to_beat: 0,
    ptb_venue: ptbVenueForTf(tf),
    resolved: false,
    unavailable: false,
  };
}

export type SettledOutcome = "up" | "down";

export interface SettlementResult {
  outcome: SettledOutcome;
  outcomes: string[];
  prices: number[];
}

/** Parse a Gamma stringified JSON array (e.g. `"[\"Up\", \"Down\"]"`). */
function parseGammaArray(raw: string | undefined): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch Polymarket's OFFICIAL settled outcome for a slug (the ground truth a
 * market resolves to), independent of any locally-computed direction.
 * Returns null when the market is not found, not yet resolved, or tied.
 */
export async function fetchSettledOutcome(
  gammaUrl: string,
  slug: string,
): Promise<SettlementResult | null> {
  const url = `${gammaUrl.replace(/\/$/, "")}/events/slug/${slug}`;
  // Hard timeout: without it a single stalled request (flaky link) would hang
  // the settlement reconciler forever, since it skips overlapping runs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let event: GammaEvent;
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    event = (await resp.json()) as GammaEvent;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  for (const m of event.markets ?? []) {
    // NB: Polymarket leaves `closed: false` on these short up/down markets even
    // after the outcome is locked, so we resolve on a decisive outcomePrices
    // value (≥0.99) rather than the `closed` flag. The reconciler only queries
    // already-ended periods, so a 0.99+ price is the final result, not a transient.
    const outcomes = parseGammaArray(m.outcomes);
    const prices = parseGammaArray(m.outcomePrices)?.map(Number);
    if (!outcomes || !prices || outcomes.length !== prices.length) continue;

    let winIdx = -1;
    for (let i = 0; i < prices.length; i++) {
      if (Number.isFinite(prices[i]!) && prices[i]! >= 0.99) winIdx = i;
    }
    if (winIdx < 0) continue; // not yet decided / still trading near 50-50

    const label = outcomes[winIdx]!.toUpperCase();
    if (label === "UP" || label === "YES") return { outcome: "up", outcomes, prices };
    if (label === "DOWN" || label === "NO") return { outcome: "down", outcomes, prices };
  }
  return null;
}

export type MarketCache = Map<string, MarketInfo>;

export function marketCacheKey(asset: Asset, tf: TimeFrame): string {
  return `${asset}_${tf}`;
}

export function newMarketCache(): MarketCache {
  return new Map();
}

export async function refreshAllMarkets(
  cache: MarketCache,
  gammaUrl: string,
  clobUrl: string,
  assets: Asset[] = ALL_ASSETS,
  timeframes: TimeFrame[] = ALL_TIMEFRAMES,
): Promise<void> {
  for (const asset of assets) {
    for (const tf of timeframes) {
      const periodStart = currentPeriodStart(tf);
      try {
        const info = await resolveMarket(gammaUrl, clobUrl, asset, tf, periodStart);
        cache.set(marketCacheKey(asset, tf), info);
      } catch (err) {
        console.warn(`market_cache: ${asset}/${tf} resolve error:`, err);
      }
    }
  }
}

export function spawnMarketCacheRefresh(
  cache: MarketCache,
  gammaUrl: string,
  clobUrl: string,
  intervalSecs = 30,
  assets: Asset[] = ALL_ASSETS,
  timeframes: TimeFrame[] = ALL_TIMEFRAMES,
): void {
  const tick = async () => {
    await refreshAllMarkets(cache, gammaUrl, clobUrl, assets, timeframes);
    setTimeout(tick, intervalSecs * 1000);
  };
  void tick();
}
