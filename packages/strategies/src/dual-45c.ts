import { join } from "node:path";
import {
  askBidDir,
  loadPeriods,
  loadQuotes,
  parseEtDateRange,
} from "./loader.js";
import { restingBuyFill } from "./fill-model.js";
import type { Dual45cParams, DualMarketResult, StrategySummary } from "./types.js";

export function runDual45c(params: Dual45cParams): {
  summary: StrategySummary;
  results: DualMarketResult[];
} {
  const limitPrice = params.limitPrice ?? 0.45;
  const shares = params.shares ?? 5;
  const exitSecs = params.exitSecs ?? 10;
  let startUnix: number | undefined;
  let endUnix: number | undefined;
  if (params.startDate && params.endDate) {
    [startUnix, endUnix] = parseEtDateRange(params.startDate, params.endDate);
  }

  const periods = loadPeriods(params.dataDir, params.asset, params.tf, startUnix, endUnix);
  const abDir = askBidDir(params.dataDir, params.asset, params.tf);
  const results: DualMarketResult[] = [];
  let holdTotal = 0; // P&L if lone legs were held to settlement (comparison)

  for (const period of periods) {
    const qpath = join(abDir, `${period.slug}.jsonl`);
    const quotes = loadQuotes(qpath);
    if (!quotes.length) continue;

    const tMin = period.period_start * 1000;
    const tMax = period.period_end * 1000;
    let yesEntry: number | null = null;
    let noEntry: number | null = null;
    let yesFillT = 0;
    let noFillT = 0;

    for (const q of quotes) {
      if (q.ts_ms < tMin || q.ts_ms >= tMax) continue;
      if (yesEntry === null) {
        const f = restingBuyFill(q.yes_ask, limitPrice, shares);
        if (f.filled) {
          yesEntry = f.price;
          yesFillT = q.ts_ms;
        }
      }
      if (noEntry === null) {
        const f = restingBuyFill(q.no_ask, limitPrice, shares);
        if (f.filled) {
          noEntry = f.price;
          noFillT = q.ts_ms;
        }
      }
      if (yesEntry !== null && noEntry !== null) break;
    }

    if (yesEntry === null && noEntry === null) continue;

    // Best bid for a side at/after `fillT + exitSecs` (fallback: last seen bid).
    const exitBidFor = (side: "yes" | "no", fillT: number): number => {
      const exitAt = fillT + exitSecs * 1000;
      let last = 0;
      for (const q of quotes) {
        if (q.ts_ms < tMin || q.ts_ms >= tMax) continue;
        const b = side === "yes" ? q.yes_bid : q.no_bid;
        if (b > 0) last = b;
        if (q.ts_ms >= exitAt && b > 0) return b;
      }
      return last;
    };

    let yesFill: DualMarketResult["yes_fill"];
    let noFill: DualMarketResult["no_fill"];
    let mktExit = 0;
    let mktHold = 0;

    if (yesEntry !== null && noEntry !== null) {
      // Both legs filled → real arb, held to settlement (exactly one pays $1).
      const yWon = period.direction === "up";
      const nWon = period.direction === "down";
      const yPnl = ((yWon ? 1 : 0) - yesEntry) * shares;
      const nPnl = ((nWon ? 1 : 0) - noEntry) * shares;
      yesFill = { entry: yesEntry, won: yWon, pnl: yPnl };
      noFill = { entry: noEntry, won: nWon, pnl: nPnl };
      mktExit = yPnl + nPnl;
      mktHold = mktExit;
    } else if (yesEntry !== null) {
      const holdPnl = ((period.direction === "up" ? 1 : 0) - yesEntry) * shares;
      mktHold = holdPnl;
      const bid = exitSecs > 0 ? exitBidFor("yes", yesFillT) : 0;
      const exitPnl = bid > 0 ? (bid - yesEntry) * shares : holdPnl;
      yesFill = { entry: yesEntry, won: exitPnl >= 0, pnl: exitPnl, exited: bid > 0 };
      mktExit = exitPnl;
    } else if (noEntry !== null) {
      const holdPnl = ((period.direction === "down" ? 1 : 0) - noEntry) * shares;
      mktHold = holdPnl;
      const bid = exitSecs > 0 ? exitBidFor("no", noFillT) : 0;
      const exitPnl = bid > 0 ? (bid - noEntry) * shares : holdPnl;
      noFill = { entry: noEntry, won: exitPnl >= 0, pnl: exitPnl, exited: bid > 0 };
      mktExit = exitPnl;
    }

    holdTotal += mktHold;
    results.push({
      slug: period.slug,
      period_start: period.period_start,
      settlement: period.direction,
      yes_fill: yesFill,
      no_fill: noFill,
      total_pnl: mktExit,
    });
  }

  const positions = results.flatMap((r) => {
    const out = [];
    if (r.yes_fill) out.push(r.yes_fill);
    if (r.no_fill) out.push(r.no_fill);
    return out;
  });
  const wins = positions.filter((p) => p.won).length;
  const totalPnl = results.reduce((s, r) => s + r.total_pnl, 0);

  return {
    summary: {
      strategy: "dual_45c",
      asset: params.asset,
      tf: params.tf,
      markets: periods.length,
      trades: positions.length,
      wins,
      losses: positions.length - wins,
      win_rate: positions.length ? wins / positions.length : 0,
      total_pnl: totalPnl,
      avg_pnl: positions.length ? totalPnl / positions.length : 0,
      skipped: periods.length - results.length,
      hold_pnl: Math.round(holdTotal * 100) / 100,
      params: { limit_price: limitPrice, shares, exit_secs: exitSecs },
    },
    results,
  };
}
