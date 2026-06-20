export type Asset = "BTC" | "ETH" | "XRP" | "SOL" | "BNB" | "HYPE" | "DOGE";

export const ALL_ASSETS: Asset[] = [
  "BTC", "ETH", "XRP", "SOL", "BNB", "HYPE", "DOGE",
];

export const BINANCE_ASSETS: Asset[] = [
  "BTC", "ETH", "XRP", "SOL", "BNB", "DOGE",
];

export type TimeFrame = "5m" | "15m" | "1h";

export const ALL_TIMEFRAMES: TimeFrame[] = ["5m", "15m", "1h"];

export type Venue = "Binance" | "Chainlink";

export type PtbVenue = "chainlink" | "binance";

export type MarketKey = `${Asset}_${TimeFrame}`;

export interface Level {
  price: string;
  size: string;
}

export interface PriceTick {
  ts_ms: number;
  asset: Asset;
  venue: Venue;
  price: number;
}

export interface OrderBookSnapshot {
  ts_ms: number;
  asset: Asset;
  tf: TimeFrame;
  yes_bids: Level[];
  yes_asks: Level[];
  no_bids: Level[];
  no_asks: Level[];
}

export interface MarketInfo {
  asset: Asset;
  tf: TimeFrame;
  period_start_unix: number;
  slug: string;
  condition_id: string;
  yes_token_id: string;
  no_token_id: string;
  price_to_beat: number;
  ptb_venue: PtbVenue;
  resolved: boolean;
  unavailable: boolean;
}

export interface BinanceChainlinkSpread {
  ts_ms: number;
  asset: Asset;
  binance: number;
  chainlink: number;
  diff_usd: number;
  diff_bps: number;
}

export interface ClPtbDeviation {
  ts_ms: number;
  asset: Asset;
  tf: string;
  chainlink_ptb: number;
  binance_vs_ptb: number;
  chainlink_vs_ptb: number;
}

export interface CollectorFrame {
  ts_ms: number;
  prices: Record<string, number>;
  yes_best_bid: Record<string, number>;
  yes_best_ask: Record<string, number>;
  no_best_bid: Record<string, number>;
  no_best_ask: Record<string, number>;
  price_to_beat: Record<string, number>;
  ptb_by_venue: Record<string, number>;
  books: Record<string, OrderBookSnapshot>;
  candles: Record<string, Array<[number, number]>>;
  binance_chainlink_spread: Record<string, BinanceChainlinkSpread>;
  cl_ptb_deviation: Record<string, ClPtbDeviation>;
}

export interface SettlementEvent {
  asset: Asset;
  tf: TimeFrame;
  period_start: number;
  new_period_start: number;
  slug: string;
  open_price: number;
  close_price: number;
  direction: "up" | "down" | "flat";
  final_book?: OrderBookSnapshot;
  ts_ms: number;
}

export function assetSlug(asset: Asset): string {
  const map: Record<Asset, string> = {
    BTC: "bitcoin",
    ETH: "ethereum",
    XRP: "xrp",
    SOL: "solana",
    BNB: "bnb",
    HYPE: "hype",
    DOGE: "dogecoin",
  };
  return map[asset];
}

export function assetTicker(asset: Asset): string {
  const map: Record<Asset, string> = {
    BTC: "btc",
    ETH: "eth",
    XRP: "xrp",
    SOL: "sol",
    BNB: "bnb",
    HYPE: "hype",
    DOGE: "doge",
  };
  return map[asset];
}

export function binanceSymbol(asset: Asset): string {
  return `${assetTicker(asset)}usdt`;
}

export function chainlinkSymbol(asset: Asset): string {
  return `${assetTicker(asset)}/usd`;
}

export function tfFolder(tf: TimeFrame): string {
  if (tf === "5m") return "5min";
  if (tf === "15m") return "15min";
  return "1hour";
}

export function marketKey(asset: Asset, tf: TimeFrame): MarketKey {
  return `${asset}_${tf}`;
}

export function priceKey(asset: Asset, venue: Venue): string {
  return `${asset}_${venue}`;
}

export function ptbVenueKey(asset: Asset, tf: TimeFrame, venue: string): string {
  return `${asset}_${tf}_${venue}`;
}

export function bestBid(snapshot: OrderBookSnapshot): number {
  const p = snapshot.yes_bids[0]?.price;
  return p ? parseFloat(p) : 0;
}

export function bestAsk(snapshot: OrderBookSnapshot): number {
  const p = snapshot.yes_asks[0]?.price;
  return p ? parseFloat(p) : 0;
}

export function computeBinanceChainlinkSpread(
  ts_ms: number,
  asset: Asset,
  binance: number,
  chainlink: number,
): BinanceChainlinkSpread | null {
  if (binance <= 0 || chainlink <= 0) return null;
  const diff_usd = binance - chainlink;
  const diff_bps = (diff_usd / chainlink) * 10_000;
  return { ts_ms, asset, binance, chainlink, diff_usd, diff_bps };
}

export function computeClPtbDeviation(
  ts_ms: number,
  asset: Asset,
  tf: string,
  chainlink_ptb: number,
  binance: number,
  chainlink: number,
): ClPtbDeviation | null {
  if (chainlink_ptb <= 0) return null;
  return {
    ts_ms,
    asset,
    tf,
    chainlink_ptb,
    binance_vs_ptb: binance > 0 ? binance - chainlink_ptb : 0,
    chainlink_vs_ptb: chainlink > 0 ? chainlink - chainlink_ptb : 0,
  };
}

export function parseAsset(s: string): Asset | null {
  const up = s.toUpperCase();
  return ALL_ASSETS.includes(up as Asset) ? (up as Asset) : null;
}

export function parseTimeFrame(s: string): TimeFrame | null {
  const norm = s.toLowerCase();
  if (norm === "5m" || norm === "5min") return "5m";
  if (norm === "15m" || norm === "15min") return "15m";
  if (norm === "1h" || norm === "1hour" || norm === "hour") return "1h";
  return null;
}
