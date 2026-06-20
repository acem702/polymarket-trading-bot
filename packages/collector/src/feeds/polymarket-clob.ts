import WebSocket from "ws";
import {
  JsonlWriter,
  marketKey,
  nowMs,
  sleep,
  tfFolder,
  type Asset,
  type Level,
  type MarketInfo,
  type OrderBookSnapshot,
  type TimeFrame,
} from "@pmt/shared";
import type { MarketCache } from "./market-resolve.js";
import { marketCacheKey } from "./market-resolve.js";
import type { CollectorState } from "../state.js";
import type { Logger } from "pino";

const CLOB_WS = "wss://ws-subscriptions-clob.polymarket.com/ws/market";
const SNAPSHOT_THROTTLE_MS = 200;

function parseLevels(arr: unknown[]): Level[] {
  return arr
    .map((v) => {
      const row = v as Record<string, string>;
      return { price: row.price ?? "0", size: row.size ?? "0" };
    })
    .filter((l) => parseFloat(l.price) > 0);
}

function sortLevels(bids: Level[], asks: Level[]): void {
  bids.sort((a, b) => parseFloat(b.price) - parseFloat(a.price));
  asks.sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
}

function normalizeYesNoBooks(
  yesBids: Level[], yesAsks: Level[], noBids: Level[], noAsks: Level[],
): void {
  const yb = parseFloat(yesBids[0]?.price ?? "0");
  const ya = parseFloat(yesAsks[0]?.price ?? "0");
  const nb = parseFloat(noBids[0]?.price ?? "0");
  const na = parseFloat(noAsks[0]?.price ?? "0");
  const swappedDown = yb > 0.55 && ya === 0 && nb === 0 && na > 0 && na < 0.45;
  const swappedUp = ya > 0.55 && yb === 0 && na === 0 && nb > 0 && nb < 0.45;
  if (swappedDown || swappedUp) {
    const tmpBids = [...yesBids];
    const tmpAsks = [...yesAsks];
    yesBids.splice(0, yesBids.length, ...noBids);
    yesAsks.splice(0, yesAsks.length, ...noAsks);
    noBids.splice(0, noBids.length, ...tmpBids);
    noAsks.splice(0, noAsks.length, ...tmpAsks);
    sortLevels(yesBids, yesAsks);
    sortLevels(noBids, noAsks);
  }
}

function applyChange(levels: Level[], side: string, price: string, size: string): void {
  const isBid = side.toUpperCase() === "BUY";
  const book = isBid ? levels : levels;
  const idx = book.findIndex((l) => l.price === price);
  if (parseFloat(size) === 0) {
    if (idx >= 0) book.splice(idx, 1);
  } else if (idx >= 0) {
    book[idx] = { price, size };
  } else {
    book.push({ price, size });
  }
}

interface ActiveConn {
  periodStart: number;
  abort: AbortController;
}

export function spawnClobManager(
  marketCache: MarketCache,
  state: CollectorState,
  dataDir: string,
  log: Logger,
): void {
  const bookWriters = new Map<string, JsonlWriter>();
  const abWriters = new Map<string, JsonlWriter>();
  const active = new Map<string, ActiveConn>();

  const scan = () => {
    for (const info of marketCache.values()) {
      if (info.unavailable || !info.yes_token_id) continue;
      const key = marketCacheKey(info.asset, info.tf);
      const existing = active.get(key);
      if (existing?.periodStart === info.period_start_unix) continue;

      existing?.abort.abort();
      const abort = new AbortController();
      active.set(key, { periodStart: info.period_start_unix, abort });

      const tf = tfFolder(info.tf);
      bookWriters.set(info.slug, JsonlWriter.open(
        `${dataDir}/order_books/${tf}/${info.asset}/${info.slug}.jsonl`,
      ));
      abWriters.set(info.slug, JsonlWriter.open(
        `${dataDir}/ask_bid_prices/${tf}/${info.asset}/${info.slug}.jsonl`,
      ));

      log.info({ asset: info.asset, tf: info.tf, slug: info.slug }, "clob_ws: spawning");
      void runMarketStream(info, state, marketCache, bookWriters, abWriters, log, abort.signal);
    }
    setTimeout(scan, 30_000);
  };
  setTimeout(scan, 5_000);
}

async function runMarketStream(
  market: MarketInfo,
  state: CollectorState,
  cache: MarketCache,
  bookWriters: Map<string, JsonlWriter>,
  abWriters: Map<string, JsonlWriter>,
  log: Logger,
  signal: AbortSignal,
): Promise<void> {
  const { asset, tf, period_start_unix: periodStart, slug } = market;
  const yesId = market.yes_token_id;
  const noId = market.no_token_id;
  const mkey = marketKey(asset, tf);
  let backoff = 500;

  while (!signal.aborted) {
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(CLOB_WS);
      const yesBids: Level[] = [];
      const yesAsks: Level[] = [];
      const noBids: Level[] = [];
      const noAsks: Level[] = [];

      const flush = (tsMs: number, force = false) => {
        normalizeYesNoBooks(yesBids, yesAsks, noBids, noAsks);
        const now = nowMs();
        const last = state.book_last_sampled.get(mkey) ?? 0;
        if (!force && now - last < SNAPSHOT_THROTTLE_MS) return;
        const any = yesBids.length || yesAsks.length || noBids.length || noAsks.length;
        if (!any) return;

        const snapshot: OrderBookSnapshot = {
          ts_ms: tsMs,
          asset, tf,
          yes_bids: [...yesBids],
          yes_asks: [...yesAsks],
          no_bids: [...noBids],
          no_asks: [...noAsks],
        };

        abWriters.get(slug)?.write({
          ts_ms: tsMs, asset, tf, slug,
          yes_best_bid: parseFloat(yesBids[0]?.price ?? "0"),
          yes_best_ask: parseFloat(yesAsks[0]?.price ?? "0"),
          no_best_bid: parseFloat(noBids[0]?.price ?? "0"),
          no_best_ask: parseFloat(noAsks[0]?.price ?? "0"),
        });
        bookWriters.get(slug)?.write(snapshot);

        const current = cache.get(marketCacheKey(asset, tf));
        if (current?.period_start_unix === periodStart) {
          state.updateBook(asset, tf, snapshot);
        }
      };

      const ping = setInterval(() => ws.ping(), 20_000);
      const snapshot = setInterval(() => flush(nowMs(), true), 1_000);
      const resub = setInterval(() => {
        const current = cache.get(marketCacheKey(asset, tf));
        if (!current || current.period_start_unix !== periodStart) {
          ws.terminate();
        }
      }, 5_000);

      const cleanup = () => {
        clearInterval(ping);
        clearInterval(snapshot);
        clearInterval(resub);
        resolve();
      };

      signal.addEventListener("abort", () => ws.terminate(), { once: true });

      ws.on("open", () => {
        backoff = 500;
        const assetIds = [yesId];
        if (noId) assetIds.push(noId);
        ws.send(JSON.stringify({ assets_ids: assetIds, type: "market", initial_dump: true }));
      });

      ws.on("message", (data) => {
        try {
          const parsed = JSON.parse(data.toString());
          const msgs = Array.isArray(parsed) ? parsed : [parsed];
          for (const msg of msgs as Array<Record<string, unknown>>) {
            const eventType = String(msg.event_type ?? "");
            const aid = String(msg.asset_id ?? "");
            const slot = aid === yesId ? 0 : aid === noId ? 1 : -1;
            if (slot < 0) continue;
            const tsMs = Number(msg.timestamp ?? nowMs());

            if (eventType === "book") {
              const bids = parseLevels((msg.bids as unknown[]) ?? []);
              const asks = parseLevels((msg.asks as unknown[]) ?? []);
              sortLevels(bids, asks);
              if (slot === 0) { yesBids.splice(0, yesBids.length, ...bids); yesAsks.splice(0, yesAsks.length, ...asks); }
              else { noBids.splice(0, noBids.length, ...bids); noAsks.splice(0, noAsks.length, ...asks); }
              flush(tsMs);
            } else if (eventType === "price_change") {
              const changes = (msg.price_changes ?? msg.changes) as Array<Record<string, string>> | undefined;
              if (!changes) continue;
              for (const ch of changes) {
                const chAid = ch.asset_id ?? "";
                const chSlot = chAid === yesId ? 0 : chAid === noId ? 1 : -1;
                if (chSlot < 0) continue;
                const targetBids = chSlot === 0 ? yesBids : noBids;
                const targetAsks = chSlot === 0 ? yesAsks : noAsks;
                const side = ch.side ?? "";
                const levels = side.toUpperCase() === "BUY" ? targetBids : targetAsks;
                applyChange(levels, side, ch.price ?? "0", ch.size ?? "0");
                sortLevels(chSlot === 0 ? yesBids : noBids, chSlot === 0 ? yesAsks : noAsks);
              }
              flush(tsMs);
            }
          }
        } catch {
          // ignore
        }
      });

      ws.on("close", cleanup);
      ws.on("error", () => { ws.terminate(); cleanup(); });
    });

    if (signal.aborted) break;
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 30_000);
  }
}
