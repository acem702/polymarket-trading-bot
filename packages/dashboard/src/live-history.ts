import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Asset, TimeFrame } from "@pmt/shared";
import type { LiveStrategyId } from "./live-engine.js";

export interface LiveTradeRecord {
  ts_ms: number;
  strategy: LiveStrategyId;
  asset: Asset;
  tf: TimeFrame;
  period_start: number;
  side: "yes" | "no";
  price: number;
  shares: number;
  order_id?: string;
  status: "ok" | "error" | "paper";
  error?: string;
  mode: "paper" | "live";
}

export interface LiveHistoryQuery {
  strategy?: string;
  asset?: string;
  tf?: string;
  limit?: number;
}

const MAX_MEMORY = 500;

export class LiveTradeHistory {
  private records: LiveTradeRecord[] = [];
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, "live_trades.jsonl");
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const lines = readFileSync(this.filePath, "utf8").split("\n");
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          this.records.push(JSON.parse(line) as LiveTradeRecord);
        } catch {
          // skip bad line
        }
      }
      if (this.records.length > MAX_MEMORY) {
        this.records = this.records.slice(-MAX_MEMORY);
      }
    } catch {
      this.records = [];
    }
  }

  append(record: LiveTradeRecord): void {
    this.records.push(record);
    if (this.records.length > MAX_MEMORY) {
      this.records.shift();
    }
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      appendFileSync(this.filePath, `${JSON.stringify(record)}\n`);
    } catch {
      // non-fatal
    }
  }

  list(query: LiveHistoryQuery = {}): LiveTradeRecord[] {
    const limit = Math.min(Math.max(query.limit ?? 100, 1), MAX_MEMORY);
    let rows = this.records;
    if (query.strategy) {
      rows = rows.filter((r) => r.strategy === query.strategy);
    }
    if (query.asset) {
      rows = rows.filter((r) => r.asset === query.asset);
    }
    if (query.tf) {
      rows = rows.filter((r) => r.tf === query.tf);
    }
    return rows.slice(-limit).reverse();
  }
}
