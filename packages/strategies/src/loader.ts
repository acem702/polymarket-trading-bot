import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime } from "luxon";
import { tfFolder, type Asset, type TimeFrame } from "@pmt/shared";
import type { DevRow, PriceTick, Quote, SimPeriod } from "./types.js";

export function tfPeriodSecs(tf: TimeFrame): number {
  if (tf === "5m") return 300;
  if (tf === "15m") return 900;
  return 3600;
}

export function marketDataPath(dataDir: string, asset: Asset, tf: TimeFrame): string {
  return join(dataDir, "market_data", tfFolder(tf), asset, `${tf}.jsonl`);
}

export function askBidDir(dataDir: string, asset: Asset, tf: TimeFrame): string {
  return join(dataDir, "ask_bid_prices", tfFolder(tf), asset);
}

export function binancePricePath(dataDir: string, asset: Asset): string {
  return join(dataDir, "prices", "binance", `${asset}.jsonl`);
}

export function ptbDevPath(dataDir: string, asset: Asset, tf: TimeFrame): string {
  return join(dataDir, "spread", "cl_ptb_deviation", `${asset}_${tf}.jsonl`);
}

export function settlementsPath(dataDir: string, asset: Asset, tf: TimeFrame): string {
  return join(dataDir, "settlements", `${asset}_${tf}.json`);
}

/**
 * Polymarket's official settled outcomes (period_start -> up/down), populated by
 * the `audit:settlement` CLI. When present, the backtest prefers these over the
 * locally-computed `direction` field, which is only an approximation.
 */
export function loadOfficialOutcomes(
  dataDir: string,
  asset: Asset,
  tf: TimeFrame,
): Map<number, "up" | "down"> {
  const path = settlementsPath(dataDir, asset, tf);
  const map = new Map<number, "up" | "down">();
  if (!existsSync(path)) return map;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      outcomes?: Record<string, string>;
    };
    for (const [k, v] of Object.entries(data.outcomes ?? {})) {
      if (v === "up" || v === "down") map.set(Number(k), v);
    }
  } catch {
    // ignore malformed cache
  }
  return map;
}

export function parseEtDateRange(startDate: string, endDate: string): [number, number] {
  const start = DateTime.fromISO(startDate, { zone: "America/New_York" }).startOf("day");
  const end = DateTime.fromISO(endDate, { zone: "America/New_York" }).startOf("day").plus({ days: 1 });
  return [Math.floor(start.toSeconds()), Math.floor(end.toSeconds())];
}

export function loadPeriods(
  dataDir: string,
  asset: Asset,
  tf: TimeFrame,
  startUnix?: number,
  endUnix?: number,
): SimPeriod[] {
  const periodSecs = tfPeriodSecs(tf);
  const path = marketDataPath(dataDir, asset, tf);
  if (!existsSync(path)) return [];

  const seen = new Set<number>();
  const out: SimPeriod[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      if (r.direction !== "up" && r.direction !== "down") continue;
      const ps = Number(r.period_start);
      if (!ps || seen.has(ps)) continue;
      if (startUnix !== undefined && ps < startUnix) continue;
      if (endUnix !== undefined && ps >= endUnix) continue;
      seen.add(ps);
      let pe = Number(r.period_end);
      if (pe <= ps) pe = ps + periodSecs;
      out.push({
        slug: String(r.slug),
        period_start: ps,
        period_end: pe,
        direction: r.direction as "up" | "down",
      });
    } catch {
      // skip
    }
  }

  // Prefer Polymarket's official resolution where we have it.
  const official = loadOfficialOutcomes(dataDir, asset, tf);
  if (official.size) {
    for (const p of out) {
      const o = official.get(p.period_start);
      if (o) p.direction = o;
    }
  }
  return out;
}

export function loadQuotes(slugPath: string): Quote[] {
  if (!existsSync(slugPath)) return [];
  const rows: Quote[] = [];
  for (const line of readFileSync(slugPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      rows.push({
        ts_ms: Number(r.ts_ms),
        yes_ask: Number(r.yes_best_ask ?? 0),
        no_ask: Number(r.no_best_ask ?? 0),
      });
    } catch {
      // skip
    }
  }
  rows.sort((a, b) => a.ts_ms - b.ts_ms);
  return rows;
}

export function loadBinancePrices(
  path: string,
  tMinMs: number,
  tMaxMs: number,
): PriceTick[] {
  if (!existsSync(path)) return [];
  const rows: PriceTick[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      const ts = Number(r.ts_ms);
      if (ts < tMinMs || ts >= tMaxMs) continue;
      rows.push({ ts_ms: ts, price: Number(r.price) });
    } catch {
      // skip
    }
  }
  rows.sort((a, b) => a.ts_ms - b.ts_ms);
  return rows;
}

export function loadDeviations(path: string): DevRow[] {
  if (!existsSync(path)) return [];
  const rows: DevRow[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      rows.push({
        ts_ms: Number(r.ts_ms),
        binance_vs_ptb: Number(r.binance_vs_ptb ?? r.coinbase_vs_ptb ?? 0),
      });
    } catch {
      // skip
    }
  }
  rows.sort((a, b) => a.ts_ms - b.ts_ms);
  return rows;
}

export function quoteAt(quotes: Quote[], tsMs: number): Quote | null {
  if (!quotes.length) return null;
  let lo = 0;
  let hi = quotes.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (quotes[mid]!.ts_ms <= tsMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? quotes[best]! : null;
}

export function bisectRight(arr: number[], x: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
