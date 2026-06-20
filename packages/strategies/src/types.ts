import type { Asset, TimeFrame } from "@pmt/shared";

export type Side = "yes" | "no";
export type Direction = "up" | "down";

export interface SimPeriod {
  slug: string;
  period_start: number;
  period_end: number;
  direction: Direction;
}

export interface Quote {
  ts_ms: number;
  yes_ask: number;
  no_ask: number;
}

export interface PriceTick {
  ts_ms: number;
  price: number;
}

export interface DevRow {
  ts_ms: number;
  binance_vs_ptb: number;
}

export interface SimParams {
  dataDir: string;
  asset: Asset;
  tf: TimeFrame;
  shares?: number;
  startDate?: string;
  endDate?: string;
}

export interface Dual45cParams extends SimParams {
  limitPrice?: number;
}

export interface Momentum90cParams extends SimParams {
  limitPrice?: number;
  thresholdUsd: number;
  windowSecs?: number;
  signalTailSecs?: number;
}

export interface PtbDeviationParams extends SimParams {
  limitPrice?: number;
  thresholdUsd: number;
  signalWindowSecs?: number;
}

export interface TradeResult {
  slug: string;
  period_start: number;
  side: Side;
  entry: number;
  won: boolean;
  pnl: number;
  settlement: Direction;
}

export interface DualMarketResult {
  slug: string;
  period_start: number;
  settlement: Direction;
  yes_fill?: { entry: number; won: boolean; pnl: number };
  no_fill?: { entry: number; won: boolean; pnl: number };
  total_pnl: number;
}

export interface StrategySummary {
  strategy: string;
  asset: Asset;
  tf: TimeFrame;
  markets: number;
  trades: number;
  wins: number;
  losses: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  skipped: number;
  params: Record<string, unknown>;
}

export const DEFAULT_THRESHOLDS: Record<Asset, number> = {
  BTC: 20,
  ETH: 4,
  SOL: 0.12,
  BNB: 2,
  DOGE: 0.01,
  XRP: 0.1,
  HYPE: 0.2,
};

export const DEFAULT_PTB_THRESHOLDS: Record<string, number> = {
  BTC_5m: 145,
  BTC_15m: 128,
  ETH_5m: 9,
  ETH_15m: 6,
  SOL_5m: 0.3,
  SOL_15m: 0.45,
  BNB_5m: 2,
  BNB_15m: 1.5,
  DOGE_5m: 0.01,
  DOGE_15m: 0.008,
  XRP_5m: 0.1,
  XRP_15m: 0.08,
  HYPE_5m: 0.2,
  HYPE_15m: 0.15,
};
