import {
  currentPeriodStart,
  marketKey,
  priceKey,
  resolveMarket,
  type Asset,
  type CollectorFrame,
  type TimeFrame,
  type TradingConfig,
} from "@pmt/shared";
import type { LiveState } from "./api.js";
import type { ClobExecutor } from "./clob-executor.js";
import type { LiveHistoryQuery, LiveTradeHistory, LiveTradeRecord } from "./live-history.js";
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
}

interface LiveRunner extends LiveRunnerPublic {
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

export class LiveStrategyEngine {
  private runners = new Map<string, LiveRunner>();

  constructor(
    private readonly trading: TradingConfig,
    private readonly executor: ClobExecutor | null = null,
    private readonly history: LiveTradeHistory | null = null,
  ) {}

  private orderMode(): "paper" | "live" {
    return this.executor?.isLive() ? "live" : "paper";
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
    };
    this.runners.set(key, runner);
    void this.refreshTokens(runner);
    return this.publicView(runner);
  }

  stop(strategy: string, asset: string, tf: string): LiveRunnerPublic | null {
    const key = runnerKey(strategy, asset, tf);
    const r = this.runners.get(key);
    if (!r) return null;
    r.active = false;
    r.status = "stopped";
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

    const signal: LiveSignal = {
      ts_ms: Date.now(),
      period_start: runner.period_start,
      side: "both",
      entry: limit,
      message: `LIVE open dual — UP+DOWN limit BUY @ ${limit.toFixed(2)} × ${shares} (GTD ${restSecs}s)`,
    };
    this.pushSignal(runner, signal);

    if (!this.executor?.isLive()) {
      runner.dual_orders_placed = true;
      runner.dual_orders_placing = false;
      runner.status = "live — paper dual limits (not sent)";
      this.recordTrade(runner, "yes", limit, shares, { ok: false, error: "paper mode" });
      this.recordTrade(runner, "no", limit, shares, { ok: false, error: "paper mode" });
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
        signal.message += ` [UP ${yesResult.orderId}]`;
      } else if (yesResult.error) {
        signal.order_error = yesResult.error;
        signal.message += ` [UP err: ${yesResult.error}]`;
      }

      if (noResult.ok && noResult.orderId) {
        runner.no_order_id = noResult.orderId;
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
    } finally {
      runner.dual_orders_placing = false;
    }
  }

  private async placeOrder(
    runner: LiveRunner,
    side: "yes" | "no",
    price: number,
    shares: number,
    signal: LiveSignal,
  ): Promise<void> {
    if (!this.executor?.isLive()) return;

    const tokenId = side === "yes" ? runner.yes_token_id : runner.no_token_id;
    if (!tokenId) {
      signal.order_error = "token id not resolved";
      signal.message += " (no token)";
      return;
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
  }

  private async emitSignal(
    runner: LiveRunner,
    partial: Omit<LiveSignal, "order_id" | "order_error">,
    shares: number,
  ): Promise<void> {
    const signal: LiveSignal = { ...partial };
    this.pushSignal(runner, signal);
    if (partial.side === "yes" || partial.side === "no") {
      if (this.executor?.isLive()) {
        await this.placeOrder(runner, partial.side, partial.entry, shares, signal);
      } else {
        this.recordTrade(runner, partial.side, partial.entry, shares, {
          ok: false,
          error: "paper mode",
        });
      }
    }
  }

  private resetPeriod(runner: LiveRunner, periodStart: number): void {
    runner.period_start = periodStart;
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

    if (runner.strategy === "dual_45c") {
      if (!runner.dual_orders_placed && !runner.dual_orders_placing && runner.yes_token_id && runner.no_token_id) {
        void this.placeDualOpenOrders(runner);
      }
      if (runner.dual_orders_placed) {
        if (runner.yes_order_id && runner.no_order_id) {
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
