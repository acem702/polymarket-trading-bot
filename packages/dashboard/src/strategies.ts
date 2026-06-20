import {
  DEFAULT_PTB_THRESHOLDS,
  DEFAULT_THRESHOLDS,
  runDual45c,
  runMomentum90c,
  runPtbDeviation,
  type Dual45cParams,
  type Momentum90cParams,
  type PtbDeviationParams,
} from "@pmt/strategies";
import { parseAsset, parseTimeFrame, type Asset, type StrategiesConfig, type TimeFrame } from "@pmt/shared";

export interface StrategyRunRequest {
  strategy: "dual_45c" | "momentum_90c" | "ptb_deviation";
  asset: string;
  tf: string;
  start_date?: string;
  end_date?: string;
  shares?: number;
  limit_price?: number;
  threshold_usd?: number;
  window_secs?: number;
  signal_tail_secs?: number;
  signal_window_secs?: number;
}

export function getDefaultThreshold(asset: Asset, tf: TimeFrame): number {
  return DEFAULT_PTB_THRESHOLDS[`${asset}_${tf}`]
    ?? DEFAULT_THRESHOLDS[asset]
    ?? 10;
}

export function runStrategy(dataDir: string, req: StrategyRunRequest, strategies?: StrategiesConfig) {
  const asset = parseAsset(req.asset);
  const tf = parseTimeFrame(req.tf);
  if (!asset || !tf) {
    throw new Error(`invalid asset/tf: ${req.asset}/${req.tf}`);
  }

  const defaults = strategies;
  const base = {
    dataDir,
    asset,
    tf,
    shares: req.shares ?? defaults?.shares ?? 5,
    startDate: req.start_date,
    endDate: req.end_date,
  };

  switch (req.strategy) {
    case "dual_45c":
      return runDual45c({
        ...base,
        limitPrice: req.limit_price ?? defaults?.dual_45c.limit_price ?? 0.45,
      } satisfies Dual45cParams);

    case "momentum_90c":
      return runMomentum90c({
        ...base,
        limitPrice: req.limit_price ?? defaults?.momentum_90c.limit_price ?? 0.90,
        thresholdUsd: req.threshold_usd ?? DEFAULT_THRESHOLDS[asset],
        windowSecs: req.window_secs ?? defaults?.momentum_90c.window_secs,
        signalTailSecs: req.signal_tail_secs ?? defaults?.momentum_90c.signal_tail_secs,
      } satisfies Momentum90cParams);

    case "ptb_deviation":
      return runPtbDeviation({
        ...base,
        limitPrice: req.limit_price ?? defaults?.ptb_deviation.limit_price ?? 0.99,
        thresholdUsd: req.threshold_usd ?? getDefaultThreshold(asset, tf),
        signalWindowSecs: req.signal_window_secs ?? defaults?.ptb_deviation.signal_window_secs,
      } satisfies PtbDeviationParams);

    default:
      throw new Error(`unknown strategy: ${req.strategy}`);
  }
}

export function listStrategyDefaults(strategies?: StrategiesConfig) {
  const s = strategies;
  return {
    dual_45c: {
      name: "45c Dual",
      description: "Limit BUY YES + NO @ 45c at each market open",
      limit_price: s?.dual_45c.limit_price ?? 0.45,
      shares: s?.shares ?? 5,
    },
    momentum_90c: {
      name: "90c Momentum",
      description: "Binance 3s momentum in last 3min → BUY @ 90c",
      limit_price: s?.momentum_90c.limit_price ?? 0.90,
      window_secs: s?.momentum_90c.window_secs ?? 3,
      signal_tail_secs: s?.momentum_90c.signal_tail_secs ?? 180,
      shares: s?.shares ?? 5,
      default_thresholds: DEFAULT_THRESHOLDS,
    },
    ptb_deviation: {
      name: "PTB Deviation",
      description: "Binance vs Chainlink PTB deviation in last 60s",
      limit_price: s?.ptb_deviation.limit_price ?? 0.99,
      signal_window_secs: s?.ptb_deviation.signal_window_secs ?? 60,
      shares: s?.shares ?? 5,
      default_thresholds: DEFAULT_PTB_THRESHOLDS,
    },
  };
}
