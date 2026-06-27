import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** One settled period's outcome + realized P&L (paper or live). */
export interface SettlementResult {
  ts_ms: number;
  strategy: string;
  asset: string;
  tf: string;
  period_start: number;
  slug: string;
  mode: "paper" | "live";
  outcome: "up" | "down";
  yes_shares: number;
  yes_cost: number;
  no_shares: number;
  no_cost: number;
  both_filled: boolean;
  pnl: number;
}

export interface ResultsQuery {
  asset?: string;
  tf?: string;
  strategy?: string;
  mode?: string;
}

export interface ResultsSummary {
  settled: number;
  arb_count: number;
  single_count: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  arb_pnl: number;
  single_pnl: number;
  by_asset: Array<{ asset: string; settled: number; pnl: number }>;
}

const MAX_MEMORY = 100_000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Append-only log of settled periods with realized P&L, plus aggregation. */
export class ResultsLog {
  private records: SettlementResult[] = [];
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "live_results.jsonl");
    this.load();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      for (const line of readFileSync(this.filePath, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
          this.records.push(JSON.parse(line) as SettlementResult);
        } catch {
          // skip bad line
        }
      }
      if (this.records.length > MAX_MEMORY) this.records = this.records.slice(-MAX_MEMORY);
    } catch {
      this.records = [];
    }
  }

  append(r: SettlementResult): void {
    this.records.push(r);
    if (this.records.length > MAX_MEMORY) this.records.shift();
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(r)}\n`);
    } catch {
      // non-fatal
    }
  }

  private filter(q: ResultsQuery): SettlementResult[] {
    return this.records.filter(
      (r) =>
        (!q.asset || r.asset === q.asset) &&
        (!q.tf || r.tf === q.tf) &&
        (!q.strategy || r.strategy === q.strategy) &&
        (!q.mode || r.mode === q.mode),
    );
  }

  list(q: ResultsQuery = {}, limit = 50): SettlementResult[] {
    return this.filter(q).slice(-limit).reverse();
  }

  summary(q: ResultsQuery = {}): ResultsSummary {
    const rows = this.filter(q);
    let arb = 0;
    let single = 0;
    let wins = 0;
    let losses = 0;
    let total = 0;
    let arbPnl = 0;
    let singlePnl = 0;
    const byAsset = new Map<string, { settled: number; pnl: number }>();

    for (const r of rows) {
      total += r.pnl;
      if (r.pnl >= 0) wins++;
      else losses++;
      if (r.both_filled) {
        arb++;
        arbPnl += r.pnl;
      } else {
        single++;
        singlePnl += r.pnl;
      }
      const a = byAsset.get(r.asset) ?? { settled: 0, pnl: 0 };
      a.settled++;
      a.pnl += r.pnl;
      byAsset.set(r.asset, a);
    }

    const n = rows.length;
    return {
      settled: n,
      arb_count: arb,
      single_count: single,
      wins,
      losses,
      win_rate: n ? wins / n : 0,
      total_pnl: round2(total),
      avg_pnl: n ? round2(total / n) : 0,
      arb_pnl: round2(arbPnl),
      single_pnl: round2(singlePnl),
      by_asset: [...byAsset.entries()].map(([asset, v]) => ({
        asset,
        settled: v.settled,
        pnl: round2(v.pnl),
      })),
    };
  }
}
