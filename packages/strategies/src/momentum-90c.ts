import { join } from "node:path";
import {
  askBidDir,
  binancePricePath,
  loadBinancePrices,
  loadPeriods,
  loadQuotes,
  parseEtDateRange,
  quoteAt,
  tfPeriodSecs,
} from "./loader.js";
import type { Direction, Momentum90cParams, StrategySummary, TradeResult } from "./types.js";

interface MomentumEvent {
  ts_ms: number;
  period_start: number;
  direction: Direction;
  move_usd: number;
}

const RECORD_STEP: Record<string, number> = {
  BTC: 1.0,
  ETH: 0.1,
  SOL: 0.01,
  BNB: 0.05,
  DOGE: 0.0005,
  XRP: 0.005,
  HYPE: 0.01,
};

function periodIndex(tsSec: number, starts: number[]): number {
  let lo = 0;
  let hi = starts.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid]! <= tsSec) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function detectMomentumEvents(
  ticks: Array<{ ts_ms: number; price: number }>,
  periods: Array<{ period_start: number; period_end: number }>,
  windowSecs: number,
  recordStep: number,
): MomentumEvent[] {
  if (!ticks.length || !periods.length) return [];
  const windowMs = windowSecs * 1000;
  const sorted = [...periods].sort((a, b) => a.period_start - b.period_start);
  const starts = sorted.map((p) => p.period_start);
  const ends = sorted.map((p) => p.period_end);
  const bestUp = new Map<number, number>();
  const bestDown = new Map<number, number>();
  const events: MomentumEvent[] = [];
  const samples: Array<{ ts: number; px: number }> = [];

  for (const tick of ticks) {
    const ts = tick.ts_ms;
    const px = tick.price;
    const tsSec = Math.floor(ts / 1000);
    const idx = periodIndex(tsSec, starts);
    if (idx < 0 || tsSec >= ends[idx]!) continue;
    const ps = starts[idx]!;

    samples.push({ ts, px });
    const cutoff = ts - windowMs;
    while (samples.length > 1 && samples[0]!.ts < cutoff) samples.shift();
    if (samples.length < 2) continue;

    let wmin = samples[0]!.px;
    let wmax = samples[0]!.px;
    for (const s of samples) {
      if (s.px < wmin) wmin = s.px;
      if (s.px > wmax) wmax = s.px;
    }

    const upMove = px - wmin;
    const downMove = wmax - px;

    const prevUp = bestUp.get(ps) ?? 0;
    if (upMove > prevUp && (prevUp === 0 || upMove >= prevUp + recordStep)) {
      bestUp.set(ps, upMove);
      events.push({ ts_ms: ts, period_start: ps, direction: "up", move_usd: upMove });
    }

    const prevDown = bestDown.get(ps) ?? 0;
    if (downMove > prevDown && (prevDown === 0 || downMove >= prevDown + recordStep)) {
      bestDown.set(ps, downMove);
      events.push({ ts_ms: ts, period_start: ps, direction: "down", move_usd: downMove });
    }
  }
  return events;
}

function filterTailEvents(
  events: MomentumEvent[],
  periodSecs: number,
  tailSecs: number,
  periods: Map<number, { period_end: number }>,
): MomentumEvent[] {
  return events.filter((e) => {
    const p = periods.get(e.period_start);
    if (!p) return false;
    const offset = Math.floor(e.ts_ms / 1000) - e.period_start;
    return offset >= periodSecs - tailSecs;
  });
}

function firstSignalPerPeriod(events: MomentumEvent[], threshold: number): MomentumEvent[] {
  const qualifying = events.filter((e) => e.move_usd >= threshold).sort((a, b) => a.ts_ms - b.ts_ms);
  const seen = new Set<number>();
  const out: MomentumEvent[] = [];
  for (const e of qualifying) {
    if (seen.has(e.period_start)) continue;
    seen.add(e.period_start);
    out.push(e);
  }
  return out;
}

export function runMomentum90c(params: Momentum90cParams): {
  summary: StrategySummary;
  trades: TradeResult[];
} {
  const limitPrice = params.limitPrice ?? 0.90;
  const windowSecs = params.windowSecs ?? 3;
  const tailSecs = params.signalTailSecs ?? 180;
  const shares = params.shares ?? 5;
  const recordStep = RECORD_STEP[params.asset] ?? 0.1;

  let startUnix: number | undefined;
  let endUnix: number | undefined;
  if (params.startDate && params.endDate) {
    [startUnix, endUnix] = parseEtDateRange(params.startDate, params.endDate);
  }

  const periods = loadPeriods(params.dataDir, params.asset, params.tf, startUnix, endUnix);
  if (!periods.length) {
    return emptyResult(params, limitPrice, windowSecs, tailSecs, shares);
  }

  const periodMap = new Map(periods.map((p) => [p.period_start, p]));
  const tMinMs = Math.min(...periods.map((p) => p.period_start)) * 1000;
  const tMaxMs = Math.max(...periods.map((p) => p.period_end)) * 1000;
  const ticks = loadBinancePrices(binancePricePath(params.dataDir, params.asset), tMinMs, tMaxMs);
  if (!ticks.length) return emptyResult(params, limitPrice, windowSecs, tailSecs, shares);

  const allEvents = detectMomentumEvents(ticks, periods, windowSecs, recordStep);
  const tailEvents = filterTailEvents(allEvents, tfPeriodSecs(params.tf), tailSecs, periodMap);
  const signals = firstSignalPerPeriod(tailEvents, params.thresholdUsd);

  const abDir = askBidDir(params.dataDir, params.asset, params.tf);
  const quotesCache = new Map<string, ReturnType<typeof loadQuotes>>();
  const trades: TradeResult[] = [];
  let skipped = 0;

  for (const ev of signals) {
    const period = periodMap.get(ev.period_start);
    if (!period) continue;

    let quotes = quotesCache.get(period.slug);
    if (!quotes) {
      quotes = loadQuotes(join(abDir, `${period.slug}.jsonl`));
      quotesCache.set(period.slug, quotes);
    }
    const q = quoteAt(quotes, ev.ts_ms);
    if (!q) { skipped++; continue; }

    const side = ev.direction === "up" ? "yes" as const : "no" as const;
    const ask = side === "yes" ? q.yes_ask : q.no_ask;
    if (ask <= 0 || ask > limitPrice) { skipped++; continue; }

    const won = (side === "yes" && period.direction === "up")
      || (side === "no" && period.direction === "down");
    const pnl = ((won ? 1 : 0) - ask) * shares;

    trades.push({
      slug: period.slug,
      period_start: period.period_start,
      side,
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
      strategy: "momentum_90c",
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
        window_secs: windowSecs,
        signal_tail_secs: tailSecs,
        shares,
      },
    },
    trades,
  };
}

function emptyResult(
  params: Momentum90cParams,
  limitPrice: number,
  windowSecs: number,
  tailSecs: number,
  shares: number,
) {
  return {
    summary: {
      strategy: "momentum_90c",
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
        window_secs: windowSecs,
        signal_tail_secs: tailSecs,
        shares,
      },
    },
    trades: [] as TradeResult[],
  };
}
