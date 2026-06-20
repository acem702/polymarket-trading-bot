import WebSocket from "ws";
import {
  ALL_ASSETS,
  chainlinkSymbol,
  JsonlWriter,
  nowMs,
  sleep,
  type Asset,
} from "@pmt/shared";
import type { CollectorState } from "../state.js";
import type { Logger } from "pino";

function assetFromChainlinkSymbol(sym: string): Asset | null {
  const up = sym.toUpperCase();
  for (const a of ALL_ASSETS) {
    if (up.startsWith(a)) return a;
  }
  return null;
}

function ingestTick(
  asset: Asset,
  price: number,
  tsMs: number,
  state: CollectorState,
  writers: Map<Asset, JsonlWriter>,
): void {
  state.updatePrice(asset, "Chainlink", price, tsMs);
  state.updateChainlinkWindow(asset, price, tsMs);
  const tickSecs = Math.floor(tsMs / 1000);
  writers.get(asset)?.write({
    ts_ms: tsMs,
    asset,
    venue: "Chainlink",
    price,
    period_5m: Math.floor(tickSecs / 300) * 300,
    period_15m: Math.floor(tickSecs / 900) * 900,
  });
}

function handleText(
  text: string,
  state: CollectorState,
  writers: Map<Asset, JsonlWriter>,
): boolean {
  let v: Record<string, unknown>;
  try {
    v = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return false;
  }

  const topic = String(v.topic ?? "");
  let payload: Record<string, unknown>;
  if (typeof v.payload === "string") {
    try {
      payload = JSON.parse(v.payload) as Record<string, unknown>;
    } catch {
      return false;
    }
  } else if (v.payload && typeof v.payload === "object") {
    payload = v.payload as Record<string, unknown>;
  } else {
    return false;
  }

  const sym = String(payload.symbol ?? "");
  const isChainlink =
    topic.includes("chainlink") ||
    (topic === "crypto_prices" && sym.includes("/"));

  if (!isChainlink) return false;

  if (Array.isArray(payload.data)) {
    const symbol = String(payload.symbol ?? "").toUpperCase();
    const asset = assetFromChainlinkSymbol(symbol);
    if (!asset) return false;
    let handled = false;
    for (const point of payload.data as Array<Record<string, unknown>>) {
      const priceV = point.value ?? point.price ?? point.current;
      const price = typeof priceV === "string" ? parseFloat(priceV) : Number(priceV);
      if (!price || price <= 0) continue;
      const tsMs = Number(point.timestamp ?? point.updatedAt ?? nowMs());
      ingestTick(asset, price, tsMs, state, writers);
      handled = true;
    }
    return handled;
  }

  const symbol = String(payload.symbol ?? "").toUpperCase();
  const asset = assetFromChainlinkSymbol(symbol);
  if (!asset) return false;
  const priceV = payload.value ?? payload.price ?? payload.current;
  const price = typeof priceV === "string" ? parseFloat(priceV) : Number(priceV);
  if (!price || price <= 0) return false;
  const tsMs = Number(payload.timestamp ?? payload.updatedAt ?? nowMs());
  ingestTick(asset, price, tsMs, state, writers);
  return true;
}

export function spawnChainlink(
  wsUrl: string,
  state: CollectorState,
  writers: Map<Asset, JsonlWriter>,
  log: Logger,
  reconnectFlag: { value: boolean },
): void {
  void runChainlink(wsUrl, state, writers, log, reconnectFlag);
}

async function runChainlink(
  wsUrl: string,
  state: CollectorState,
  writers: Map<Asset, JsonlWriter>,
  log: Logger,
  reconnectFlag: { value: boolean },
): Promise<void> {
  let backoff = 1_000;
  while (true) {
    reconnectFlag.value = false;
    log.info({ wsUrl }, "chainlink: connecting");
    await new Promise<void>((resolve) => {
      const ws = new WebSocket(wsUrl);
      let lastTickMs = 0;
      const connectedAt = nowMs();

      const ping = setInterval(() => {
        if (reconnectFlag.value) {
          ws.terminate();
          return;
        }
        if (ws.readyState === WebSocket.OPEN) ws.send("PING");
        const now = nowMs();
        if (lastTickMs > 0 && (now - lastTickMs) / 1000 >= 30) {
          log.warn("chainlink: stale feed — reconnecting");
          ws.terminate();
        } else if (lastTickMs === 0 && (now - connectedAt) / 1000 >= 30) {
          log.warn("chainlink: no tick since connect — reconnecting");
          ws.terminate();
        }
      }, 5_000);

      const silence = setTimeout(() => {
        log.warn("chainlink: no WS frame — reconnecting");
        ws.terminate();
      }, 30_000);

      const resetSilence = () => {
        clearTimeout(silence);
        setTimeout(() => ws.terminate(), 30_000);
      };

      ws.on("open", () => {
        backoff = 1_000;
        log.info("chainlink: connected");
        const subscriptions = ALL_ASSETS.map((asset) => ({
          topic: "crypto_prices_chainlink",
          type: "*",
          filters: JSON.stringify({ symbol: chainlinkSymbol(asset) }),
        }));
        ws.send(JSON.stringify({ action: "subscribe", subscriptions }));
      });

      ws.on("message", (data) => {
        resetSilence();
        const text = data.toString();
        if (text.toLowerCase() === "pong") return;
        if (handleText(text, state, writers)) lastTickMs = nowMs();
      });

      ws.on("close", () => { clearInterval(ping); clearTimeout(silence); resolve(); });
      ws.on("error", (err) => {
        log.warn({ err: err.message }, "chainlink: stream error");
        clearInterval(ping);
        clearTimeout(silence);
        ws.terminate();
        resolve();
      });
    });
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 300_000);
  }
}
