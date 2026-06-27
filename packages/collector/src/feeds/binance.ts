import WebSocket from "ws";
import {
  BINANCE_ASSETS,
  binanceSymbol,
  JsonlWriter,
  nowMs,
  sleep,
  type Asset,
} from "@pmt/shared";
import type { CollectorState } from "../state.js";
import type { Logger } from "pino";

function buildAssetUrl(base: string, asset: Asset): string {
  let b = base.replace(/\/$/, "");
  if (b.endsWith("/stream")) b = b.slice(0, -7).replace(/\/$/, "");
  if (b.endsWith("/ws")) b = b.slice(0, -3).replace(/\/$/, "");
  return `${b}/ws/${binanceSymbol(asset)}@aggTrade`;
}

function assetFromSymbol(sym: string): Asset | null {
  const map: Record<string, Asset> = {
    btcusdt: "BTC", ethusdt: "ETH", xrpusdt: "XRP",
    solusdt: "SOL", bnbusdt: "BNB", dogeusdt: "DOGE",
  };
  return map[sym.toLowerCase()] ?? null;
}

export function spawnBinance(
  wsBaseUrl: string,
  state: CollectorState,
  writers: Map<Asset, JsonlWriter>,
  log: Logger,
  assets: Asset[] = BINANCE_ASSETS,
): void {
  for (const asset of BINANCE_ASSETS) {
    if (!assets.includes(asset)) continue;
    void runBinanceAsset(wsBaseUrl, asset, state, writers, log);
  }
}

async function runBinanceAsset(
  wsBaseUrl: string,
  asset: Asset,
  state: CollectorState,
  writers: Map<Asset, JsonlWriter>,
  log: Logger,
): Promise<void> {
  const url = buildAssetUrl(wsBaseUrl, asset);
  let backoff = 500;
  while (true) {
    log.info({ asset, url }, "binance: connecting");
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(url);
      const ping = setInterval(() => ws.ping(), 20_000);

      ws.on("open", () => {
        backoff = 500;
        log.info({ asset }, "binance: connected");
      });

      ws.on("message", (data) => {
        try {
          const text = data.toString();
          const v = JSON.parse(text) as Record<string, unknown>;
          const payload = (v.data ?? v) as Record<string, unknown>;
          const stream = String(v.stream ?? "");
          const eventType = String(payload.e ?? "");
          if (!stream.includes("aggTrade") && eventType !== "aggTrade") return;

          const symbol = String(payload.s ?? "");
          const a = assetFromSymbol(symbol) ?? asset;
          const price = parseFloat(String(payload.p ?? "0"));
          if (price <= 0) return;

          const tsMs = nowMs();
          state.updatePrice(a, "Binance", price, tsMs);
          state.updateBinancePtbWindows(a, price, tsMs);
          writers.get(a)?.write({ ts_ms: tsMs, asset: a, venue: "Binance", price });
        } catch {
          // ignore parse errors
        }
      });

      ws.on("close", () => {
        clearInterval(ping);
        resolve();
      });
      ws.on("error", (err) => {
        log.warn({ asset, err: err.message }, "binance: stream error");
        clearInterval(ping);
        ws.terminate();
        resolve();
      });
    });
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 30_000);
  }
}
