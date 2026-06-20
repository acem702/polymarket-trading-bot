import { DateTime } from "luxon";
import {
  ALL_ASSETS,
  ALL_TIMEFRAMES,
  buildSlugFor,
  computeBinanceChainlinkSpread,
  computeClPtbDeviation,
  marketKey,
  priceKey,
  ptbVenueKey,
  type Asset,
  type CollectorFrame,
  type OrderBookSnapshot,
  type SettlementEvent,
  type TimeFrame,
  type Venue,
} from "@pmt/shared";
import { nowMs } from "@pmt/shared";

type Direction = "up" | "down" | "flat";

interface AssetWindowState {
  chainlink_5m_period?: number;
  chainlink_5m_open: number;
  chainlink_15m_period?: number;
  chainlink_15m_open: number;
  chainlink_1h_period?: number;
  chainlink_1h_open: number;
  binance_5m_period?: number;
  binance_5m_open: number;
  binance_15m_period?: number;
  binance_15m_open: number;
  binance_1h_period?: number;
  binance_1h_open: number;
}

interface Candle1mBuilder {
  bucket_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

function direction(open: number, close: number): Direction {
  if (close > open) return "up";
  if (close < open) return "down";
  return "flat";
}

function etHourPeriodStart(tsMs: number): number {
  const dt = DateTime.fromMillis(tsMs, { zone: "utc" }).setZone("America/New_York");
  return Math.floor(dt.startOf("hour").toSeconds());
}

export class CollectorState {
  prices = new Map<string, number>();
  yes_best_bid = new Map<string, number>();
  yes_best_ask = new Map<string, number>();
  no_best_bid = new Map<string, number>();
  no_best_ask = new Map<string, number>();
  price_to_beat = new Map<string, number>();
  books = new Map<string, OrderBookSnapshot>();
  book_last_sampled = new Map<string, number>();
  candle_builders = new Map<string, Candle1mBuilder>();
  candles = new Map<string, Array<[number, number]>>();
  windows = new Map<Asset, AssetWindowState>();
  chainlink_tick_ts_ms = new Map<Asset, number>();
  binance_tick_ts_ms = new Map<Asset, number>();
  ptb_by_venue = new Map<string, number>();

  constructor(private onSettlement?: (evt: SettlementEvent) => void) {}

  updatePrice(asset: Asset, venue: Venue, price: number, tsMs: number): void {
    const key = priceKey(asset, venue);
    this.prices.set(key, price);
    if (venue === "Binance") this.binance_tick_ts_ms.set(asset, tsMs);

    let builder = this.candle_builders.get(key);
    const bucket = Math.floor(tsMs / 60_000) * 60_000;
    if (!builder || builder.bucket_ms !== bucket) {
      if (builder && builder.bucket_ms > 0) {
        const ring = this.candles.get(key) ?? [];
        if (ring.length >= 60) ring.shift();
        ring.push([builder.bucket_ms, builder.open]);
        this.candles.set(key, ring);
      }
      builder = { bucket_ms: bucket, open: price, high: price, low: price, close: price };
      this.candle_builders.set(key, builder);
    } else {
      builder.high = Math.max(builder.high, price);
      builder.low = Math.min(builder.low, price);
      builder.close = price;
    }
  }

  updateBook(asset: Asset, tf: TimeFrame, book: OrderBookSnapshot): void {
    const key = marketKey(asset, tf);
    this.books.set(key, book);
    const yb = book.yes_bids[0]?.price;
    const ya = book.yes_asks[0]?.price;
    const nb = book.no_bids[0]?.price;
    const na = book.no_asks[0]?.price;
    if (yb) this.yes_best_bid.set(key, parseFloat(yb));
    if (ya) this.yes_best_ask.set(key, parseFloat(ya));
    if (nb) this.no_best_bid.set(key, parseFloat(nb));
    if (na) this.no_best_ask.set(key, parseFloat(na));
    this.book_last_sampled.set(key, book.ts_ms);
  }

  setPriceToBeat(asset: Asset, tf: TimeFrame, price: number): void {
    this.price_to_beat.set(marketKey(asset, tf), price);
  }

  private getWindow(asset: Asset): AssetWindowState {
    let w = this.windows.get(asset);
    if (!w) {
      w = {
        chainlink_5m_open: 0, chainlink_15m_open: 0, chainlink_1h_open: 0,
        binance_5m_open: 0, binance_15m_open: 0, binance_1h_open: 0,
      };
      this.windows.set(asset, w);
    }
    return w;
  }

  private emitSettlement(evt: SettlementEvent): void {
    this.onSettlement?.(evt);
  }

  updateChainlinkWindow(asset: Asset, price: number, tsMs: number): void {
    const tickSecs = Math.floor(tsMs / 1000);
    const period5m = Math.floor(tickSecs / 300) * 300;
    const period15m = Math.floor(tickSecs / 900) * 900;
    const w = this.getWindow(asset);

    if (w.chainlink_5m_period !== period5m) {
      if (w.chainlink_5m_period !== undefined) {
        const mkey = marketKey(asset, "5m");
        this.emitSettlement({
          asset, tf: "5m",
          period_start: w.chainlink_5m_period,
          new_period_start: period5m,
          slug: buildSlugFor(asset, "5m", w.chainlink_5m_period),
          open_price: w.chainlink_5m_open,
          close_price: price,
          direction: direction(w.chainlink_5m_open, price),
          final_book: this.books.get(mkey),
          ts_ms: nowMs(),
        });
      }
      w.chainlink_5m_open = price;
      w.chainlink_5m_period = period5m;
      this.price_to_beat.set(marketKey(asset, "5m"), price);
      this.ptb_by_venue.set(ptbVenueKey(asset, "5m", "Chainlink"), price);
    }

    if (w.chainlink_15m_period !== period15m) {
      if (w.chainlink_15m_period !== undefined) {
        const mkey = marketKey(asset, "15m");
        this.emitSettlement({
          asset, tf: "15m",
          period_start: w.chainlink_15m_period,
          new_period_start: period15m,
          slug: buildSlugFor(asset, "15m", w.chainlink_15m_period),
          open_price: w.chainlink_15m_open,
          close_price: price,
          direction: direction(w.chainlink_15m_open, price),
          final_book: this.books.get(mkey),
          ts_ms: nowMs(),
        });
      }
      w.chainlink_15m_open = price;
      w.chainlink_15m_period = period15m;
      this.price_to_beat.set(marketKey(asset, "15m"), price);
      this.ptb_by_venue.set(ptbVenueKey(asset, "15m", "Chainlink"), price);
    }

    const etHour = etHourPeriodStart(tsMs);
    if (w.chainlink_1h_period !== etHour) {
      w.chainlink_1h_open = price;
      w.chainlink_1h_period = etHour;
      this.ptb_by_venue.set(ptbVenueKey(asset, "1h", "Chainlink"), price);
    }

    this.chainlink_tick_ts_ms.set(asset, tsMs);
  }

  updateBinancePtbWindows(asset: Asset, price: number, tsMs: number): void {
    const tickSecs = Math.floor(tsMs / 1000);
    const period5m = Math.floor(tickSecs / 300) * 300;
    const period15m = Math.floor(tickSecs / 900) * 900;
    const w = this.getWindow(asset);

    if (w.binance_5m_period !== period5m) {
      w.binance_5m_open = price;
      w.binance_5m_period = period5m;
      this.ptb_by_venue.set(ptbVenueKey(asset, "5m", "Binance"), price);
    }
    if (w.binance_15m_period !== period15m) {
      w.binance_15m_open = price;
      w.binance_15m_period = period15m;
      this.ptb_by_venue.set(ptbVenueKey(asset, "15m", "Binance"), price);
    }

    const etHour = etHourPeriodStart(tsMs);
    if (w.binance_1h_period !== etHour) {
      if (w.binance_1h_period !== undefined) {
        const mkey = marketKey(asset, "1h");
        this.emitSettlement({
          asset, tf: "1h",
          period_start: w.binance_1h_period,
          new_period_start: etHour,
          slug: buildSlugFor(asset, "1h", w.binance_1h_period),
          open_price: w.binance_1h_open,
          close_price: price,
          direction: direction(w.binance_1h_open, price),
          final_book: this.books.get(mkey),
          ts_ms: nowMs(),
        });
      }
      w.binance_1h_open = price;
      w.binance_1h_period = etHour;
      this.price_to_beat.set(marketKey(asset, "1h"), price);
      this.ptb_by_venue.set(ptbVenueKey(asset, "1h", "Binance"), price);
    }
  }

  buildFrame(): CollectorFrame {
    const candles: Record<string, Array<[number, number]>> = {};
    for (const [k, v] of this.candles) candles[k] = [...v];
    for (const [k, b] of this.candle_builders) {
      if (b.close > 0) {
        candles[k] = [...(candles[k] ?? []), [b.bucket_ms, b.close]];
      }
    }

    const binSpread: CollectorFrame["binance_chainlink_spread"] = {};
    const clPtb: CollectorFrame["cl_ptb_deviation"] = {};
    const ts = nowMs();

    for (const asset of ALL_ASSETS) {
      const bin = this.prices.get(priceKey(asset, "Binance")) ?? 0;
      const cl = this.prices.get(priceKey(asset, "Chainlink")) ?? 0;
      const bs = computeBinanceChainlinkSpread(ts, asset, bin, cl);
      if (bs) binSpread[asset] = bs;
      for (const tf of ALL_TIMEFRAMES) {
        const ptb = this.ptb_by_venue.get(ptbVenueKey(asset, tf, "Chainlink")) ?? 0;
        const dev = computeClPtbDeviation(ts, asset, tf, ptb, bin, cl);
        if (dev) clPtb[marketKey(asset, tf)] = dev;
      }
    }

    return {
      ts_ms: ts,
      prices: Object.fromEntries(this.prices),
      yes_best_bid: Object.fromEntries(this.yes_best_bid),
      yes_best_ask: Object.fromEntries(this.yes_best_ask),
      no_best_bid: Object.fromEntries(this.no_best_bid),
      no_best_ask: Object.fromEntries(this.no_best_ask),
      price_to_beat: Object.fromEntries(this.price_to_beat),
      ptb_by_venue: Object.fromEntries(this.ptb_by_venue),
      books: Object.fromEntries(this.books),
      candles,
      binance_chainlink_spread: binSpread,
      cl_ptb_deviation: clPtb,
    };
  }
}
