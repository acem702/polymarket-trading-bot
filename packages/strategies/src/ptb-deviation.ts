import { join } from "node:path";
import {
  askBidDir,
  loadDeviations,
  loadPeriods,
  loadQuotes,
  parseEtDateRange,
  ptbDevPath,
  quoteAt,
  tfPeriodSecs,
} from "./loader.js";
import type { PtbDeviationParams, Side, StrategySummary, TradeResult } from "./types.js";

export function runPtbDeviation(params: PtbDeviationParams): {
  summary: StrategySummary;
  trades: TradeResult[];
} {
  const limitPrice = params.limitPrice ?? 0.99;
  const signalWindowSecs = params.signalWindowSecs ?? 60;
  const shares = params.shares ?? 5;

  let startUnix: number | undefined;
  let endUnix: number | undefined;
  if (params.startDate && params.endDate) {
    [startUnix, endUnix] = parseEtDateRange(params.startDate, params.endDate);
  }

  const periods = loadPeriods(params.dataDir, params.asset, params.tf, startUnix, endUnix);
  const devs = loadDeviations(ptbDevPath(params.dataDir, params.asset, params.tf));
  if (!periods.length || !devs.length) {
    return emptyResult(params, limitPrice, signalWindowSecs, shares);
  }

  const abDir = askBidDir(params.dataDir, params.asset, params.tf);
  const quotesCache = new Map<string, ReturnType<typeof loadQuotes>>();
  const trades: TradeResult[] = [];
  let skipped = 0;

  for (const period of periods) {
    const t0Ms = (period.period_end - signalWindowSecs) * 1000;
    const t1Ms = period.period_end * 1000;

    const windowDevs = devs.filter((d) => d.ts_ms >= t0Ms && d.ts_ms < t1Ms);
    if (!windowDevs.length) continue;

    let signal: { ts_ms: number; side: Side } | null = null;
    for (const d of windowDevs) {
      const abs = Math.abs(d.binance_vs_ptb);
      if (abs <= params.thresholdUsd) continue;
      const side: Side = d.binance_vs_ptb > 0 ? "yes" : "no";
      if (!signal || d.ts_ms < signal.ts_ms) {
        signal = { ts_ms: d.ts_ms, side };
      }
    }
    if (!signal) continue;

    let quotes = quotesCache.get(period.slug);
    if (!quotes) {
      quotes = loadQuotes(join(abDir, `${period.slug}.jsonl`));
      quotesCache.set(period.slug, quotes);
    }
    const q = quoteAt(quotes, signal.ts_ms);
    if (!q) { skipped++; continue; }

    const ask = signal.side === "yes" ? q.yes_ask : q.no_ask;
    if (ask <= 0 || ask > limitPrice) { skipped++; continue; }

    const won = (signal.side === "yes" && period.direction === "up")
      || (signal.side === "no" && period.direction === "down");
    const pnl = ((won ? 1 : 0) - ask) * shares;

    trades.push({
      slug: period.slug,
      period_start: period.period_start,
      side: signal.side,
      entry: ask,
      won,
      pnl,
      settlement: period.direction,
    });
  }

  const wins = trades.filter((t) => t.won).length;
  const totalPnl = trades.reduce((s, t) => s + t.pnl, 0);

  return {
    summary: {
      strategy: "ptb_deviation",
      asset: params.asset,
      tf: params.tf,
      markets: periods.length,
      trades: trades.length,
      wins,
      losses: trades.length - wins,
      win_rate: trades.length ? wins / trades.length : 0,
      total_pnl: totalPnl,
      avg_pnl: trades.length ? totalPnl / trades.length : 0,
      skipped,
      params: {
        limit_price: limitPrice,
        threshold_usd: params.thresholdUsd,
        signal_window_secs: signalWindowSecs,
        shares,
      },
    },
    trades,
  };
}

function emptyResult(
  params: PtbDeviationParams,
  limitPrice: number,
  signalWindowSecs: number,
  shares: number,
) {
  return {
    summary: {
      strategy: "ptb_deviation",
      asset: params.asset,
      tf: params.tf,
      markets: 0,
      trades: 0,
      wins: 0,
      losses: 0,
      win_rate: 0,
      total_pnl: 0,
      avg_pnl: 0,
      skipped: 0,
      params: {
        limit_price: limitPrice,
        threshold_usd: params.thresholdUsd,
        signal_window_secs: signalWindowSecs,
        shares,
      },
    },
    trades: [] as TradeResult[],
  };
}
