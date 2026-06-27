import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RiskConfig } from "@pmt/shared";

export interface RiskDecision {
  allowed: boolean;
  reason?: string;
}

export interface RiskSnapshot {
  open_exposure_usd: number;
  open_positions: number;
  daily_spend_usd: number;
  daily_remaining_usd: number;
  daily_pnl_usd: number;
  daily_loss_remaining_usd: number;
  et_date: string;
  limits: RiskConfig;
}

interface PersistedState {
  daily_spend?: Record<string, number>;
  daily_pnl?: Record<string, number>;
}

const KEEP_DAYS = 30;

const TZ_ET = "America/New_York";

/** ET calendar date (YYYY-MM-DD) for daily-budget bucketing. */
function etDate(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ_ET }).format(new Date(ms));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface OpenEntry {
  market: string;
  usd: number;
}

/**
 * Deterministic pre-trade risk gate. Every live (and paper) order must pass
 * `check()` before it is sent; once accepted, the engine calls `commit()`.
 *
 * All limits are in USD of committed order cost (price × shares) — none of this
 * depends on settlement/PnL data, so the gate is reliable even when outcome data
 * is not. Open exposure is released when a period rolls or a runner stops; the
 * daily budget is monotonic per ET day (the hard daily stop).
 */
export class RiskManager {
  /** runnerKey -> capital committed for the current period (ephemeral). */
  private open = new Map<string, OpenEntry>();
  /** ET date -> total committed that day (persisted). */
  private daily = new Map<string, number>();
  /** ET date -> realized P&L that day (persisted). */
  private pnl = new Map<string, number>();

  constructor(
    private readonly cfg: RiskConfig,
    private readonly persistPath?: string,
  ) {
    this.load();
  }

  private load(): void {
    if (!this.persistPath || !existsSync(this.persistPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.persistPath, "utf8")) as PersistedState;
      for (const [k, v] of Object.entries(data.daily_spend ?? {})) {
        if (Number.isFinite(v)) this.daily.set(k, v);
      }
      for (const [k, v] of Object.entries(data.daily_pnl ?? {})) {
        if (Number.isFinite(v)) this.pnl.set(k, v);
      }
    } catch {
      // ignore corrupt state
    }
  }

  private prune(): void {
    const trim = (m: Map<string, number>) => {
      if (m.size <= KEEP_DAYS) return;
      const keep = [...m.keys()].sort().slice(-KEEP_DAYS);
      const keepSet = new Set(keep);
      for (const k of m.keys()) if (!keepSet.has(k)) m.delete(k);
    };
    trim(this.daily);
    trim(this.pnl);
  }

  private persist(): void {
    if (!this.persistPath) return;
    this.prune();
    try {
      mkdirSync(dirname(this.persistPath), { recursive: true });
      writeFileSync(
        this.persistPath,
        JSON.stringify(
          {
            daily_spend: Object.fromEntries(this.daily),
            daily_pnl: Object.fromEntries(this.pnl),
          },
          null,
          2,
        ),
      );
    } catch {
      // non-fatal
    }
  }

  private dailySpend(ms = Date.now()): number {
    return this.daily.get(etDate(ms)) ?? 0;
  }

  private dailyPnl(ms = Date.now()): number {
    return this.pnl.get(etDate(ms)) ?? 0;
  }

  private openExposure(): number {
    let sum = 0;
    for (const e of this.open.values()) sum += e.usd;
    return sum;
  }

  private marketExposure(market: string, excludeRunner: string): number {
    let sum = 0;
    for (const [key, e] of this.open) {
      if (key === excludeRunner) continue;
      if (e.market === market) sum += e.usd;
    }
    return sum;
  }

  /**
   * Evaluate a prospective order before sending. Pass one cost for a single-leg
   * order, or two for a dual (both legs are checked atomically so we never post
   * one leg of a pair and get blocked on the other).
   */
  check(runnerKey: string, market: string, legCosts: number[]): RiskDecision {
    const total = legCosts.reduce((a, b) => a + b, 0);
    if (total <= 0) return { allowed: true };
    const eps = 1e-9;

    const pnl = this.dailyPnl();
    if (pnl <= -this.cfg.max_daily_loss_usd - eps) {
      return {
        allowed: false,
        reason: `daily loss limit hit ($${pnl.toFixed(2)} ≤ -$${this.cfg.max_daily_loss_usd})`,
      };
    }

    for (const leg of legCosts) {
      if (leg > this.cfg.max_order_usd + eps) {
        return {
          allowed: false,
          reason: `order $${leg.toFixed(2)} exceeds max order $${this.cfg.max_order_usd}`,
        };
      }
    }

    const spend = this.dailySpend();
    if (spend + total > this.cfg.max_daily_spend_usd + eps) {
      return {
        allowed: false,
        reason: `daily budget reached ($${spend.toFixed(2)}/$${this.cfg.max_daily_spend_usd})`,
      };
    }

    const open = this.openExposure();
    if (open + total > this.cfg.max_open_exposure_usd + eps) {
      return {
        allowed: false,
        reason: `open exposure cap ($${open.toFixed(2)}+$${total.toFixed(2)} > $${this.cfg.max_open_exposure_usd})`,
      };
    }

    const mkt = this.marketExposure(market, runnerKey);
    if (mkt + total > this.cfg.max_position_per_market_usd + eps) {
      return {
        allowed: false,
        reason: `per-market cap ($${(mkt + total).toFixed(2)} > $${this.cfg.max_position_per_market_usd})`,
      };
    }

    const newPosition = this.open.has(runnerKey) ? 0 : 1;
    if (this.open.size + newPosition > this.cfg.max_concurrent_positions) {
      return {
        allowed: false,
        reason: `max concurrent positions (${this.cfg.max_concurrent_positions}) reached`,
      };
    }

    return { allowed: true };
  }

  /** Record committed capital after deciding to send. */
  commit(runnerKey: string, market: string, total: number): void {
    if (total <= 0) return;
    const prev = this.open.get(runnerKey);
    this.open.set(runnerKey, { market, usd: (prev?.usd ?? 0) + total });
    const date = etDate(Date.now());
    this.daily.set(date, (this.daily.get(date) ?? 0) + total);
    this.persist();
  }

  /** Record realized P&L of a settled position (drives the daily stop-loss). */
  recordRealizedPnl(usd: number): void {
    if (!Number.isFinite(usd) || usd === 0) return;
    const date = etDate(Date.now());
    this.pnl.set(date, (this.pnl.get(date) ?? 0) + usd);
    this.persist();
  }

  /** Period rolled or runner stopped — free working capital (daily budget persists). */
  releaseOpen(runnerKey: string): void {
    this.open.delete(runnerKey);
  }

  /** All legs failed to post — undo the commit, including the daily budget. */
  refund(runnerKey: string, total: number): void {
    if (total <= 0) return;
    const prev = this.open.get(runnerKey);
    if (prev) {
      const left = prev.usd - total;
      if (left > 1e-9) this.open.set(runnerKey, { market: prev.market, usd: left });
      else this.open.delete(runnerKey);
    }
    const date = etDate(Date.now());
    this.daily.set(date, Math.max(0, (this.daily.get(date) ?? 0) - total));
    this.persist();
  }

  snapshot(): RiskSnapshot {
    const spend = this.dailySpend();
    const pnl = this.dailyPnl();
    return {
      open_exposure_usd: round2(this.openExposure()),
      open_positions: this.open.size,
      daily_spend_usd: round2(spend),
      daily_remaining_usd: round2(Math.max(0, this.cfg.max_daily_spend_usd - spend)),
      daily_pnl_usd: round2(pnl),
      daily_loss_remaining_usd: round2(Math.max(0, this.cfg.max_daily_loss_usd + pnl)),
      et_date: etDate(Date.now()),
      limits: this.cfg,
    };
  }
}
