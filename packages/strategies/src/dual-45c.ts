import { join } from "node:path";
import {
  askBidDir,
  loadPeriods,
  loadQuotes,
  parseEtDateRange,
} from "./loader.js";
import type { Dual45cParams, DualMarketResult, StrategySummary } from "./types.js";

export function runDual45c(params: Dual45cParams): {
  summary: StrategySummary;
  results: DualMarketResult[];
} {
  const limitPrice = params.limitPrice ?? 0.45;
  const shares = params.shares ?? 5;
  let startUnix: number | undefined;
  let endUnix: number | undefined;
  if (params.startDate && params.endDate) {
    [startUnix, endUnix] = parseEtDateRange(params.startDate, params.endDate);
  }

  const periods = loadPeriods(params.dataDir, params.asset, params.tf, startUnix, endUnix);
  const abDir = askBidDir(params.dataDir, params.asset, params.tf);
  const results: DualMarketResult[] = [];

  for (const period of periods) {
    const qpath = join(abDir, `${period.slug}.jsonl`);
    const quotes = loadQuotes(qpath);
    if (!quotes.length) continue;

    const tMin = period.period_start * 1000;
    const tMax = period.period_end * 1000;
    let yesEntry: number | null = null;
    let noEntry: number | null = null;

    for (const q of quotes) {
      if (q.ts_ms < tMin || q.ts_ms >= tMax) continue;
      if (yesEntry === null && q.yes_ask > 0 && q.yes_ask <= limitPrice) {
        yesEntry = q.yes_ask;
      }
      if (noEntry === null && q.no_ask > 0 && q.no_ask <= limitPrice) {
        noEntry = q.no_ask;
      }
      if (yesEntry !== null && noEntry !== null) break;
    }

    let totalPnl = 0;
    let yesFill: DualMarketResult["yes_fill"];
    let noFill: DualMarketResult["no_fill"];

    if (yesEntry !== null) {
      const won = period.direction === "up";
      const pnl = ((won ? 1 : 0) - yesEntry) * shares;
      yesFill = { entry: yesEntry, won, pnl };
      totalPnl += pnl;
    }
    if (noEntry !== null) {
      const won = period.direction === "down";
      const pnl = ((won ? 1 : 0) - noEntry) * shares;
      noFill = { entry: noEntry, won, pnl };
      totalPnl += pnl;
    }

    if (yesFill || noFill) {
      results.push({
        slug: period.slug,
        period_start: period.period_start,
        settlement: period.direction,
        yes_fill: yesFill,
        no_fill: noFill,
        total_pnl: totalPnl,
      });
    }
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
      params: { limit_price: limitPrice, shares },
    },
    results,
  };
}
