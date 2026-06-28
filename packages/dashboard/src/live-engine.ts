import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  buildSlugFor,
  currentPeriodStart,
  fetchSettledOutcome,
  marketKey,
  priceKey,
  resolveMarket,
  type Asset,
  type CollectorFrame,
  type TimeFrame,
  type TradingConfig,
} from "@pmt/shared";
import { restingBuyFill } from "@pmt/strategies";
import type { LiveState } from "./api.js";
import type { ClobExecutor, PlaceOrderResult } from "./clob-executor.js";
import type { OrderStatus } from "./clob-executor.js";
import type { LiveHistoryQuery, LiveTradeHistory, LiveTradeRecord } from "./live-history.js";
import type { RiskManager, RiskSnapshot } from "./risk-manager.js";
import type { ResultsLog } from "./results-log.js";
import type { StrategyRunRequest } from "./strategies.js";

export type LiveStrategyId = "dual_45c" | "momentum_90c" | "ptb_deviation";

export interface LiveSignal {
  ts_ms: number;
  period_start: number;
  side: "yes" | "no" | "both";
  entry: number;
  message: string;
  order_id?: string;
  order_error?: string;
}

export interface LivePosition {
  yes_shares: number;
  yes_cost: number;
  no_shares: number;
  no_cost: number;
}

export interface LiveRunnerPublic {
  strategy: LiveStrategyId;
  asset: Asset;
  tf: TimeFrame;
  active: boolean;
  started_at_ms: number;
  period_start: number;
  params: Record<string, unknown>;
  signals: LiveSignal[];
  last_tick_ms: number;
  status: string;
  mode: "paper" | "live";
  position: LivePosition;
}

/** Per-order fill-tracking record. */
interface OrderRec {
  side: "yes" | "no";
  price: number;
  original: number;
  matched: number;
  status: string;
  terminal: boolean;
  reconciled: boolean;
}

/** A filled period awaiting Polymarket settlement. */
interface PendingSettlement {
  strategy: LiveStrategyId;
  asset: Asset;
  tf: TimeFrame;
  period_start: number;
  slug: string;
  position: LivePosition;
  first_ms: number;
}

interface LiveRunner extends Omit<LiveRunnerPublic, "position"> {
  yes_filled?: boolean;
  no_filled?: boolean;
  dual_orders_placed?: boolean;
  dual_orders_placing?: boolean;
  yes_order_id?: string;
  no_order_id?: string;
  price_samples?: Array<{ ts_ms: number; price: number }>;
  momentum_fired?: boolean;
  best_up?: number;
  best_down?: number;
  ptb_fired?: boolean;
  yes_token_id?: string;
  no_token_id?: string;
  risk_blocked?: boolean;
  risk_reason?: string;
  /** Live order ids resting this period — cancelled on stop / period-roll. */
  open_order_ids?: string[];
  /** All orders placed this period, keyed by id, for fill tracking. */
  orders?: Record<string, OrderRec>;
}

const RECORD_STEP: Record<string, number> = {
  BTC: 1.0, ETH: 0.1, SOL: 0.01, BNB: 0.05, DOGE: 0.0005, XRP: 0.005, HYPE: 0.01,
};

function tfPeriodSecs(tf: TimeFrame): number {
  if (tf === "5m") return 300;
  if (tf === "15m") return 900;
  return 3600;
}

function runnerKey(strategy: string, asset: string, tf: string): string {
  return `${strategy}:${asset}:${tf}`;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

export class LiveStrategyEngine {
  private runners = new Map<string, LiveRunner>();
  private pending: PendingSettlement[] = [];

  constructor(
    private readonly trading: TradingConfig,
    private readonly executor: ClobExecutor | null = null,
    private readonly history: LiveTradeHistory | null = null,
    private readonly risk: RiskManager | null = null,
    private readonly results: ResultsLog | null = null,
    private readonly pendingPath: string | null = null,
  ) {
    this.loadPending();
  }

  private loadPending(): void {
    if (!this.pendingPath || !existsSync(this.pendingPath)) return;
    try {
      const data = JSON.parse(readFileSync(this.pendingPath, "utf8")) as PendingSettlement[];
      if (Array.isArray(data)) this.pending = data;
    } catch {
      // ignore corrupt file
    }
  }

  private persistPending(): void {
    if (!this.pendingPath) return;
    try {
      mkdirSync(dirname(this.pendingPath), { recursive: true });
      writeFileSync(this.pendingPath, JSON.stringify(this.pending));
    } catch {
      // non-fatal
    }
  }

  private orderMode(): "paper" | "live" {
    return this.executor?.isLive() ? "live" : "paper";
  }

  /** Per-period market identity used for risk bucketing. */
  private marketId(runner: LiveRunner): string {
    return `${runner.asset}_${runner.tf}@${runner.period_start}`;
  }

  riskSnapshot(): RiskSnapshot | null {
    return this.risk?.snapshot() ?? null;
  }

  tradeHistory(query: LiveHistoryQuery = {}): LiveTradeRecord[] {
    return this.history?.list(query) ?? [];
  }

  private recordTrade(
    runner: LiveRunner,
    side: "yes" | "no",
    price: number,
    shares: number,
    result: { ok: boolean; orderId?: string; error?: string },
  ): void {
    if (!this.history) return;
    const mode = this.orderMode();
    this.history.append({
      ts_ms: Date.now(),
      strategy: runner.strategy,
      asset: runner.asset,
      tf: runner.tf,
      period_start: runner.period_start,
      side,
      price,
      shares,
      order_id: result.orderId,
      status: mode === "paper" ? "paper" : result.ok ? "ok" : "error",
      error: result.error,
      mode,
    });
  }

  list(): LiveRunnerPublic[] {
    return [...this.runners.values()].map((r) => this.publicView(r));
  }

  get(strategy: string, asset: string, tf: string): LiveRunnerPublic | null {
    const r = this.runners.get(runnerKey(strategy, asset, tf));
    return r ? this.publicView(r) : null;
  }

  start(req: StrategyRunRequest): LiveRunnerPublic {
    const asset = req.asset as Asset;
    const tf = req.tf as TimeFrame;
    const strategy = req.strategy as LiveStrategyId;
    const key = runnerKey(strategy, asset, tf);
    const periodStart = currentPeriodStart(tf);

    const params: Record<string, unknown> = {
      shares: req.shares ?? 5,
      limit_price: req.limit_price,
    };
    if (strategy === "momentum_90c") {
      params.threshold_usd = req.threshold_usd;
      params.window_secs = req.window_secs ?? 3;
      params.signal_tail_secs = req.signal_tail_secs ?? 180;
    }
    if (strategy === "ptb_deviation") {
      params.threshold_usd = req.threshold_usd;
      params.signal_window_secs = req.signal_window_secs ?? 60;
    }
    if (strategy === "dual_45c") {
      params.limit_price = req.limit_price ?? 0.45;
    }
    if (strategy === "momentum_90c") {
      params.limit_price = req.limit_price ?? 0.90;
    }
    if (strategy === "ptb_deviation") {
      params.limit_price = req.limit_price ?? 0.99;
    }

    const runner: LiveRunner = {
      strategy,
      asset,
      tf,
      active: true,
      started_at_ms: Date.now(),
      period_start: periodStart,
      params,
      signals: [],
      last_tick_ms: 0,
      status:
        this.orderMode() === "live"
          ? "live — watching (real orders)"
          : "live — watching (paper — enable LIVE_TRADING_ENABLED)",
      mode: this.orderMode(),
      yes_filled: false,
      no_filled: false,
      dual_orders_placed: false,
      dual_orders_placing: false,
      price_samples: [],
      momentum_fired: false,
      best_up: 0,
      best_down: 0,
      ptb_fired: false,
      open_order_ids: [],
      orders: {},
    };
    this.runners.set(key, runner);
    void this.refreshTokens(runner);
    return this.publicView(runner);
  }

  async stop(strategy: string, asset: string, tf: string): Promise<LiveRunnerPublic | null> {
    const key = runnerKey(strategy, asset, tf);
    const r = this.runners.get(key);
    if (!r) return null;
    r.active = false;
    const ids = r.open_order_ids ?? [];
    if (ids.length) await this.cancelOrderIds(ids, r, "stop");
    r.open_order_ids = [];
    r.status = "stopped";
    this.risk?.releaseOpen(key);
    this.runners.delete(key);
    return this.publicView(r);
  }

  tick(frame: CollectorFrame | null): void {
    if (!frame) return;
    for (const runner of this.runners.values()) {
      if (!runner.active) continue;
      void this.evaluate(runner, frame);
    }
  }

  private publicView(r: LiveRunner): LiveRunnerPublic {
    const mode = this.orderMode();
    return {
      strategy: r.strategy,
      asset: r.asset,
      tf: r.tf,
      active: r.active,
      started_at_ms: r.started_at_ms,
      period_start: r.period_start,
      params: r.params,
      signals: [...r.signals],
      last_tick_ms: r.last_tick_ms,
      status: r.status,
      mode,
      position: this.computePosition(r),
    };
  }

  private pushSignal(runner: LiveRunner, signal: LiveSignal): void {
    runner.signals.push(signal);
    if (runner.signals.length > 50) runner.signals.shift();
    runner.status = signal.message;
  }

  private async refreshTokens(runner: LiveRunner): Promise<void> {
    try {
      const info = await resolveMarket(
        this.trading.gamma_url,
        this.trading.clob_url,
        runner.asset,
        runner.tf,
        runner.period_start,
      );
      runner.yes_token_id = info.yes_token_id;
      runner.no_token_id = info.no_token_id;
      if (this.executor?.isLive()) {
        await Promise.all([
          this.executor.prewarmToken(info.yes_token_id),
          this.executor.prewarmToken(info.no_token_id),
        ]);
      }
      if (runner.strategy === "dual_45c") {
        await this.placeDualOpenOrders(runner);
      }
    } catch {
      runner.yes_token_id = "";
      runner.no_token_id = "";
    }
  }

  private async placeDualOpenOrders(runner: LiveRunner): Promise<void> {
    if (runner.strategy !== "dual_45c") return;
    if (runner.dual_orders_placed || runner.dual_orders_placing) return;
    if (!runner.yes_token_id || !runner.no_token_id) return;

    runner.dual_orders_placing = true;
    const limit = Number(runner.params.limit_price ?? 0.45);
    const shares = Number(runner.params.shares ?? 5);
    const periodSecs = tfPeriodSecs(runner.tf);
    const nowSec = Math.floor(Date.now() / 1000);
    const restSecs = Math.max(1, runner.period_start + periodSecs - nowSec);

    const key = runnerKey(runner.strategy, runner.asset, runner.tf);
    const market = this.marketId(runner);
    const legCost = limit * shares;

    // Risk gating only blocks live orders. Paper tracks (commits per simulated
    // fill below) but never halts, so a multi-day analysis run keeps collecting.
    if (this.risk && this.executor?.isLive()) {
      const decision = this.risk.check(key, market, [legCost, legCost]);
      if (!decision.allowed) {
        runner.dual_orders_placing = false;
        runner.dual_orders_placed = true;
        runner.risk_blocked = true;
        runner.risk_reason = decision.reason;
        this.pushSignal(runner, {
          ts_ms: Date.now(),
          period_start: runner.period_start,
          side: "both",
          entry: limit,
          message: `BLOCKED by risk — ${decision.reason}`,
          order_error: `risk: ${decision.reason}`,
        });
        runner.status = `risk-blocked — ${decision.reason}`;
        return;
      }
      this.risk.commit(key, market, legCost * 2); // live reserves capital on placement
    }

    const tag = this.executor?.isLive() ? "LIVE" : "PAPER";
    const signal: LiveSignal = {
      ts_ms: Date.now(),
      period_start: runner.period_start,
      side: "both",
      entry: limit,
      message: `${tag} open dual — UP+DOWN limit BUY @ ${limit.toFixed(2)} × ${shares} (GTD ${restSecs}s)`,
    };
    this.pushSignal(runner, signal);

    if (!this.executor?.isLive()) {
      // Paper: both legs "rest" at `limit`. Fills are simulated per-tick against
      // the real best-ask feed in evaluate() → simulatePaperDualFills().
      runner.dual_orders_placed = true;
      runner.dual_orders_placing = false;
      runner.status = `paper — resting dual UP+DOWN @ ${limit.toFixed(2)}`;
      return;
    }

    try {
      const [yesResult, noResult] = await Promise.all([
        this.executor.placeLimitBuy(runner.yes_token_id, limit, shares, { restSecs }),
        this.executor.placeLimitBuy(runner.no_token_id, limit, shares, { restSecs }),
      ]);

      this.recordTrade(runner, "yes", limit, shares, yesResult);
      this.recordTrade(runner, "no", limit, shares, noResult);

      if (yesResult.ok && yesResult.orderId) {
        runner.yes_order_id = yesResult.orderId;
        this.registerOrder(runner, yesResult.orderId, "yes", limit, shares);
        signal.message += ` [UP ${yesResult.orderId}]`;
      } else if (yesResult.error) {
        signal.order_error = yesResult.error;
        signal.message += ` [UP err: ${yesResult.error}]`;
      }

      if (noResult.ok && noResult.orderId) {
        runner.no_order_id = noResult.orderId;
        this.registerOrder(runner, noResult.orderId, "no", limit, shares);
        signal.message += ` [DOWN ${noResult.orderId}]`;
      } else if (noResult.error) {
        const downErr = noResult.error;
        signal.order_error = signal.order_error ? `${signal.order_error}; ${downErr}` : downErr;
        signal.message += ` [DOWN err: ${downErr}]`;
      }

      runner.dual_orders_placed = true;
      if (runner.yes_order_id && runner.no_order_id) {
        runner.status = `live — resting UP+DOWN @ ${limit.toFixed(2)} until period end`;
      } else if (runner.yes_order_id || runner.no_order_id) {
        runner.status = "live — partial dual limits posted";
      } else {
        runner.status = "live — dual limit placement failed";
      }

      // Refund committed capital for any leg that failed to post.
      if (this.risk) {
        const failed = (runner.yes_order_id ? 0 : 1) + (runner.no_order_id ? 0 : 1);
        if (failed > 0) this.risk.refund(key, legCost * failed);
      }
    } finally {
      runner.dual_orders_placing = false;
    }
  }

  /** Cancel a snapshot of resting order ids (no-op in paper mode). */
  private async cancelOrderIds(
    ids: string[],
    runner: LiveRunner,
    context: string,
  ): Promise<void> {
    const live = ids.filter(Boolean);
    if (!live.length || !this.executor?.isLive()) return;
    const res = await this.executor.cancelOrders(live);
    this.pushSignal(runner, {
      ts_ms: Date.now(),
      period_start: runner.period_start,
      side: "both",
      entry: 0,
      message: res.ok
        ? `${context} — cancelled ${res.canceled.length} resting order(s)`
        : `${context} — cancel error: ${res.error}`,
      order_error: res.ok ? undefined : res.error,
    });
  }

  /** Track a freshly-posted live order for fill polling. */
  private registerOrder(
    runner: LiveRunner,
    orderId: string,
    side: "yes" | "no",
    price: number,
    shares: number,
  ): void {
    (runner.open_order_ids ??= []).push(orderId);
    (runner.orders ??= {})[orderId] = {
      side,
      price,
      original: shares,
      matched: 0,
      status: "LIVE",
      terminal: false,
      reconciled: false,
    };
  }

  /**
   * Paper fill model for dual_45c: a resting BUY limit at `limit` fills the first
   * time that side's real best-ask is in (0, limit] during the period. Records
   * the fill, commits the spent capital to risk, and builds the position so the
   * period settles against the official outcome like a live fill would.
   */
  private simulatePaperDualFills(
    runner: LiveRunner,
    yesAsk: number,
    noAsk: number,
    yesAskSize: number | undefined,
    noAskSize: number | undefined,
    limit: number,
    shares: number,
  ): void {
    if (!runner.dual_orders_placed) return;
    const key = runnerKey(runner.strategy, runner.asset, runner.tf);
    const market = this.marketId(runner);

    const tryFill = (side: "yes" | "no", ask: number, askSize: number | undefined): void => {
      const id = `paper-${side}-${runner.period_start}`;
      if (runner.orders?.[id]) return; // already filled this period
      // Resting BUY: fills at our limit (not the cheap ask), and only if the
      // book has enough size for our shares.
      const fill = restingBuyFill(ask, limit, shares, askSize);
      if (!fill.filled) return;
      (runner.orders ??= {})[id] = {
        side,
        price: fill.price,
        original: shares,
        matched: shares,
        status: "FILLED",
        terminal: true,
        reconciled: true,
      };
      this.risk?.commit(key, market, fill.price * shares);
      this.recordTrade(runner, side, fill.price, shares, { ok: true });
      this.pushSignal(runner, {
        ts_ms: Date.now(),
        period_start: runner.period_start,
        side,
        entry: fill.price,
        message: `PAPER FILL ${side.toUpperCase()} ${shares} @ ${fill.price.toFixed(2)}`,
      });
    };

    tryFill("yes", yesAsk, yesAskSize);
    tryFill("no", noAsk, noAskSize);

    const yf = !!runner.orders?.[`paper-yes-${runner.period_start}`];
    const nf = !!runner.orders?.[`paper-no-${runner.period_start}`];
    runner.status = yf && nf
      ? "paper — both legs filled (arb locked)"
      : yf
        ? "paper — UP filled, waiting for DOWN"
        : nf
          ? "paper — DOWN filled, waiting for UP"
          : `paper — resting dual @ ${limit.toFixed(2)} (no fills yet)`;
  }

  private computePosition(runner: LiveRunner): LivePosition {
    const pos: LivePosition = { yes_shares: 0, yes_cost: 0, no_shares: 0, no_cost: 0 };
    for (const rec of Object.values(runner.orders ?? {})) {
      if (rec.matched <= 0) continue;
      const cost = rec.matched * rec.price;
      if (rec.side === "yes") {
        pos.yes_shares += rec.matched;
        pos.yes_cost += cost;
      } else {
        pos.no_shares += rec.matched;
        pos.no_cost += cost;
      }
    }
    return pos;
  }

  /** Poll fill status of every active runner's non-terminal orders. */
  async pollFills(): Promise<void> {
    if (!this.executor?.isLive()) return;
    for (const runner of this.runners.values()) {
      if (!runner.active || !runner.orders) continue;
      for (const [id, rec] of Object.entries(runner.orders)) {
        if (rec.terminal) continue;
        const st = await this.executor.getOrderStatus(id);
        if (!st) continue;
        this.applyOrderStatus(runner, id, rec, st);
      }
    }
  }

  private applyOrderStatus(
    runner: LiveRunner,
    id: string,
    rec: OrderRec,
    st: OrderStatus,
  ): void {
    const prevMatched = rec.matched;
    rec.matched = Math.max(rec.matched, st.matched);
    rec.status = st.status;

    const filledDelta = rec.matched - prevMatched;
    if (filledDelta > 0) {
      this.pushSignal(runner, {
        ts_ms: Date.now(),
        period_start: runner.period_start,
        side: rec.side,
        entry: rec.price,
        message: `FILL ${filledDelta} ${rec.side.toUpperCase()} @ ${rec.price.toFixed(2)} (${rec.matched}/${rec.original})`,
      });
    }

    const statusDone = st.status !== "" && st.status.toUpperCase() !== "LIVE";
    const fullyFilled = rec.original > 0 && rec.matched >= rec.original;
    if (!statusDone && !fullyFilled) return;

    // Terminal: reconcile committed capital against what actually filled.
    rec.terminal = true;
    if (!rec.reconciled) {
      rec.reconciled = true;
      const unfilled = Math.max(0, rec.original - rec.matched);
      const unfilledUsd = unfilled * rec.price;
      if (unfilledUsd > 0 && this.risk) {
        this.risk.refund(runnerKey(runner.strategy, runner.asset, runner.tf), unfilledUsd);
      }
    }
    if (runner.open_order_ids) {
      runner.open_order_ids = runner.open_order_ids.filter((o) => o !== id);
    }
  }

  /** Queue a just-ended period's filled position for settlement (markets resolve
   * minutes later, so the reconciler retries until the outcome is available). */
  private enqueueSettlement(
    strategy: LiveStrategyId,
    asset: Asset,
    tf: TimeFrame,
    periodStart: number,
    position: LivePosition,
  ): void {
    if (position.yes_shares + position.no_shares <= 0) return;
    const dup = this.pending.some(
      (p) =>
        p.strategy === strategy &&
        p.asset === asset &&
        p.tf === tf &&
        p.period_start === periodStart,
    );
    if (dup) return;
    this.pending.push({
      strategy,
      asset,
      tf,
      period_start: periodStart,
      slug: buildSlugFor(asset, tf, periodStart),
      position,
      first_ms: Date.now(),
    });
    this.persistPending();
  }

  /** Try to settle one pending period against the official outcome. */
  private async trySettle(p: PendingSettlement): Promise<boolean> {
    const outcome = await fetchSettledOutcome(this.trading.gamma_url, p.slug);
    if (!outcome) return false;

    const payout = outcome.outcome === "up" ? p.position.yes_shares : p.position.no_shares;
    const cost = p.position.yes_cost + p.position.no_cost;
    const realized = payout - cost;
    this.risk?.recordRealizedPnl(realized);

    const both = p.position.yes_shares > 0 && p.position.no_shares > 0;
    this.results?.append({
      ts_ms: Date.now(),
      strategy: p.strategy,
      asset: p.asset,
      tf: p.tf,
      period_start: p.period_start,
      slug: p.slug,
      mode: this.orderMode(),
      outcome: outcome.outcome,
      yes_shares: p.position.yes_shares,
      yes_cost: round2(p.position.yes_cost),
      no_shares: p.position.no_shares,
      no_cost: round2(p.position.no_cost),
      both_filled: both,
      pnl: round2(realized),
    });

    const runner = this.runners.get(runnerKey(p.strategy, p.asset, p.tf));
    if (runner) {
      this.pushSignal(runner, {
        ts_ms: Date.now(),
        period_start: p.period_start,
        side: "both",
        entry: 0,
        message: `SETTLED ${outcome.outcome.toUpperCase()} ${both ? "(arb)" : "(single-leg)"} → ${realized >= 0 ? "+" : ""}$${realized.toFixed(2)}`,
      });
    }
    return true;
  }

  /**
   * Retry every queued settlement. Markets resolve a few minutes after the
   * period ends, so we keep trying for up to 45 min rather than giving up at the
   * boundary. Driven on an interval by spawnSettlementReconciler.
   */
  async settlePending(): Promise<void> {
    if (!this.pending.length) return;
    // Generous window so a long connectivity outage still syncs once back online
    // (markets stay resolved forever; the position is saved in the queue).
    const EXPIRE_MS = 6 * 60 * 60 * 1000;
    const keep: PendingSettlement[] = [];
    for (const p of this.pending) {
      let settled = false;
      try {
        settled = await this.trySettle(p);
      } catch {
        settled = false;
      }
      if (settled) continue;
      if (Date.now() - p.first_ms <= EXPIRE_MS) keep.push(p);
    }
    if (keep.length !== this.pending.length) {
      this.pending = keep;
      this.persistPending();
    }
  }

  private async placeOrder(
    runner: LiveRunner,
    side: "yes" | "no",
    price: number,
    shares: number,
    signal: LiveSignal,
  ): Promise<PlaceOrderResult | null> {
    if (!this.executor?.isLive()) return null;

    const tokenId = side === "yes" ? runner.yes_token_id : runner.no_token_id;
    if (!tokenId) {
      signal.order_error = "token id not resolved";
      signal.message += " (no token)";
      return { ok: false, error: "token id not resolved" };
    }

    const result = await this.executor.placeLimitBuy(tokenId, price, shares);
    this.recordTrade(runner, side, price, shares, result);
    if (result.ok && result.orderId) {
      signal.order_id = result.orderId;
      signal.message += ` [order ${result.orderId}]`;
    } else if (result.ok) {
      signal.message += " [order sent]";
    } else {
      signal.order_error = result.error ?? "order failed";
      signal.message += ` [order err: ${signal.order_error}]`;
    }
    return result;
  }

  private async emitSignal(
    runner: LiveRunner,
    partial: Omit<LiveSignal, "order_id" | "order_error">,
    shares: number,
  ): Promise<void> {
    const signal: LiveSignal = { ...partial };

    if (partial.side !== "yes" && partial.side !== "no") {
      this.pushSignal(runner, signal);
      return;
    }

    const key = runnerKey(runner.strategy, runner.asset, runner.tf);
    const market = this.marketId(runner);
    const legCost = partial.entry * shares;

    // Risk gating only blocks live orders (paper never halts — see placeDualOpenOrders).
    if (this.risk && this.executor?.isLive()) {
      const decision = this.risk.check(key, market, [legCost]);
      if (!decision.allowed) {
        signal.order_error = `risk: ${decision.reason}`;
        signal.message += ` [BLOCKED — ${decision.reason}]`;
        this.pushSignal(runner, signal);
        this.recordTrade(runner, partial.side, partial.entry, shares, {
          ok: false,
          error: `risk: ${decision.reason}`,
        });
        return;
      }
      this.risk.commit(key, market, legCost);
    }

    this.pushSignal(runner, signal);
    if (this.executor?.isLive()) {
      const result = await this.placeOrder(runner, partial.side, partial.entry, shares, signal);
      if (result?.ok && result.orderId) {
        this.registerOrder(runner, result.orderId, partial.side, partial.entry, shares);
      }
      if (this.risk && !result?.ok) this.risk.refund(key, legCost);
    } else {
      this.recordTrade(runner, partial.side, partial.entry, shares, {
        ok: false,
        error: "paper mode",
      });
    }
  }

  private resetPeriod(runner: LiveRunner, periodStart: number): void {
    // Settle the just-ended period's filled position → realized P&L (stop-loss).
    const endedPos = this.computePosition(runner);
    if (endedPos.yes_shares + endedPos.no_shares > 0) {
      this.enqueueSettlement(
        runner.strategy,
        runner.asset,
        runner.tf,
        runner.period_start,
        endedPos,
      );
    }

    // Cancel any of the previous period's orders still resting (GTD can linger
    // up to ~60s past the boundary) before starting the new period.
    const stale = runner.open_order_ids ?? [];
    if (stale.length) void this.cancelOrderIds(stale, runner, "period-roll");
    runner.open_order_ids = [];
    runner.orders = {};
    this.risk?.releaseOpen(runnerKey(runner.strategy, runner.asset, runner.tf));
    runner.period_start = periodStart;
    runner.risk_blocked = false;
    runner.risk_reason = undefined;
    runner.yes_filled = false;
    runner.no_filled = false;
    runner.dual_orders_placed = false;
    runner.dual_orders_placing = false;
    runner.yes_order_id = undefined;
    runner.no_order_id = undefined;
    runner.price_samples = [];
    runner.momentum_fired = false;
    runner.best_up = 0;
    runner.best_down = 0;
    runner.ptb_fired = false;
    runner.status = "live — new period";
    void this.refreshTokens(runner);
  }

  private async evaluate(runner: LiveRunner, frame: CollectorFrame): Promise<void> {
    const mkey = marketKey(runner.asset, runner.tf);
    const periodStart = currentPeriodStart(runner.tf);
    if (periodStart !== runner.period_start) {
      this.resetPeriod(runner, periodStart);
    }

    runner.last_tick_ms = frame.ts_ms;
    const tsSec = Math.floor(frame.ts_ms / 1000);
    const periodSecs = tfPeriodSecs(runner.tf);
    const offset = tsSec - runner.period_start;

    const yesAsk = frame.yes_best_ask[mkey] ?? 0;
    const noAsk = frame.no_best_ask[mkey] ?? 0;
    const limit = Number(runner.params.limit_price ?? 0.45);
    const shares = Number(runner.params.shares ?? 5);
    const book = frame.books?.[mkey];
    const yesAskSize = book?.yes_asks?.[0] ? Number(book.yes_asks[0].size) : undefined;
    const noAskSize = book?.no_asks?.[0] ? Number(book.no_asks[0].size) : undefined;

    if (runner.strategy === "dual_45c") {
      if (runner.risk_blocked) {
        runner.status = `risk-blocked — ${runner.risk_reason ?? "limit reached"}`;
        return;
      }
      if (!runner.dual_orders_placed && !runner.dual_orders_placing && runner.yes_token_id && runner.no_token_id) {
        void this.placeDualOpenOrders(runner);
      }
      if (runner.dual_orders_placed) {
        if (!this.executor?.isLive()) {
          this.simulatePaperDualFills(runner, yesAsk, noAsk, yesAskSize, noAskSize, limit, shares);
        } else if (runner.yes_order_id && runner.no_order_id) {
          runner.status = `live — resting UP+DOWN @ ${limit.toFixed(2)} until period end`;
        } else if (runner.yes_order_id || runner.no_order_id) {
          runner.status = "live — partial dual limits posted";
        } else {
          runner.status = "live — dual limit placement failed";
        }
      } else if (runner.dual_orders_placing) {
        runner.status = "live — placing UP+DOWN limits…";
      } else {
        runner.status = "live — waiting for market tokens";
      }
      return;
    }

    if (runner.strategy === "momentum_90c") {
      const tailSecs = Number(runner.params.signal_tail_secs ?? 180);
      const windowSecs = Number(runner.params.window_secs ?? 3);
      const threshold = Number(runner.params.threshold_usd ?? 20);
      const recordStep = RECORD_STEP[runner.asset] ?? 0.1;

      if (offset < periodSecs - tailSecs) {
        runner.status = `live — waiting (${periodSecs - offset}s to tail)`;
        return;
      }
      if (runner.momentum_fired) {
        runner.status = "live — signal fired this period";
        return;
      }

      const binPx = frame.prices[priceKey(runner.asset, "Binance")] ?? 0;
      if (binPx <= 0) {
        runner.status = "live — no Binance price";
        return;
      }

      const samples = runner.price_samples!;
      samples.push({ ts_ms: frame.ts_ms, price: binPx });
      const cutoff = frame.ts_ms - windowSecs * 1000;
      while (samples.length > 1 && samples[0]!.ts_ms < cutoff) samples.shift();
      if (samples.length < 2) {
        runner.status = "live — building momentum window";
        return;
      }

      let wmin = samples[0]!.price;
      let wmax = samples[0]!.price;
      for (const s of samples) {
        if (s.price < wmin) wmin = s.price;
        if (s.price > wmax) wmax = s.price;
      }
      const upMove = binPx - wmin;
      const downMove = wmax - binPx;

      if (upMove > (runner.best_up ?? 0) && (runner.best_up === 0 || upMove >= (runner.best_up ?? 0) + recordStep)) {
        runner.best_up = upMove;
        if (upMove >= threshold && yesAsk > 0 && yesAsk <= limit) {
          runner.momentum_fired = true;
          await this.emitSignal(runner, {
            ts_ms: frame.ts_ms,
            period_start: runner.period_start,
            side: "yes",
            entry: yesAsk,
            message: `LIVE momentum UP $${upMove.toFixed(2)} → YES @ ${yesAsk.toFixed(2)}`,
          }, shares);
          return;
        }
      }
      if (downMove > (runner.best_down ?? 0) && (runner.best_down === 0 || downMove >= (runner.best_down ?? 0) + recordStep)) {
        runner.best_down = downMove;
        if (downMove >= threshold && noAsk > 0 && noAsk <= limit) {
          runner.momentum_fired = true;
          await this.emitSignal(runner, {
            ts_ms: frame.ts_ms,
            period_start: runner.period_start,
            side: "no",
            entry: noAsk,
            message: `LIVE momentum DOWN $${downMove.toFixed(2)} → NO @ ${noAsk.toFixed(2)}`,
          }, shares);
          return;
        }
      }
      runner.status = `live — tail window (up $${upMove.toFixed(2)} / down $${downMove.toFixed(2)})`;
      return;
    }

    if (runner.strategy === "ptb_deviation") {
      const signalWindow = Number(runner.params.signal_window_secs ?? 60);
      const threshold = Number(runner.params.threshold_usd ?? 100);

      if (offset < periodSecs - signalWindow) {
        runner.status = `live — waiting (${periodSecs - offset}s to signal window)`;
        return;
      }
      if (runner.ptb_fired) {
        runner.status = "live — signal fired this period";
        return;
      }

      const dev = frame.cl_ptb_deviation[mkey];
      const binVsPtb = dev?.binance_vs_ptb ?? 0;
      if (Math.abs(binVsPtb) <= threshold) {
        runner.status = `live — PTB dev $${binVsPtb.toFixed(2)} (need $${threshold})`;
        return;
      }

      const side = binVsPtb > 0 ? "yes" : "no";
      const ask = side === "yes" ? yesAsk : noAsk;
      if (ask <= 0 || ask > limit) {
        runner.status = `live — PTB signal but ask ${ask.toFixed(2)} > limit`;
        return;
      }

      runner.ptb_fired = true;
      await this.emitSignal(runner, {
        ts_ms: frame.ts_ms,
        period_start: runner.period_start,
        side,
        entry: ask,
        message: `LIVE PTB dev $${binVsPtb.toFixed(2)} → ${side.toUpperCase()} @ ${ask.toFixed(2)}`,
      }, shares);
    }
  }
}

export function spawnLiveEngineTicker(live: LiveState, engine: LiveStrategyEngine): void {
  setInterval(() => {
    engine.tick(live.frame);
  }, 200);
}

/** Poll resting orders for fills (independent, slower cadence than the tick). */
export function spawnFillPoller(engine: LiveStrategyEngine, intervalMs = 3000): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    void engine.pollFills().finally(() => {
      busy = false;
    });
  }, intervalMs);
}

/** Retry pending settlements until Polymarket resolves them (minutes-lagged). */
export function spawnSettlementReconciler(engine: LiveStrategyEngine, intervalMs = 30_000): void {
  let busy = false;
  setInterval(() => {
    if (busy) return;
    busy = true;
    void engine.settlePending().finally(() => {
      busy = false;
    });
  }, intervalMs);
}
