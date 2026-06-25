import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

/** Platform-specific default IPC endpoint for collector ↔ dashboard. */
export function defaultIpcPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\polypulse";
  }
  return "/tmp/polypulse.sock";
}

function isNamedPipe(path: string): boolean {
  return process.platform === "win32" && path.startsWith("\\\\.\\pipe\\");
}

function resolveIpcPath(raw: string | undefined): string {
  const fallback = defaultIpcPath();
  const value = raw?.trim() || fallback;
  // .env.example uses the Linux path; remap when copied verbatim on Windows.
  if (process.platform === "win32" && (value === "/tmp/polypulse.sock" || value.startsWith("/tmp/"))) {
    return fallback;
  }
  return value;
}

export { isNamedPipe };

export interface CollectorConfig {
  binance_ws_url: string;
  chainlink_ws_url: string;
  gamma_url: string;
  clob_url: string;
  ipc_path: string;
  data_dir: string;
}

export interface DashboardConfig {
  bind: string;
  ipc_path: string;
  data_dir: string;
}

export interface Dual45cStrategyConfig {
  limit_price: number;
}

export interface Momentum90cStrategyConfig {
  limit_price: number;
  window_secs: number;
  signal_tail_secs: number;
}

export interface PtbDeviationStrategyConfig {
  limit_price: number;
  signal_window_secs: number;
}

export interface StrategiesConfig {
  shares: number;
  dual_45c: Dual45cStrategyConfig;
  momentum_90c: Momentum90cStrategyConfig;
  ptb_deviation: PtbDeviationStrategyConfig;
}

/** Polymarket CLOB credentials for live order execution. */
export interface TradingConfig {
  /** When true and private key is set, live mode posts real CLOB orders. */
  enabled: boolean;
  private_key: string;
  proxy_wallet_address: string;
  /** 0=EOA, 1=POLY_PROXY (email/Magic), 2=POLY_GNOSIS_SAFE (browser proxy wallet). */
  signature_type: number;
  chain_id: number;
  clob_url: string;
  gamma_url: string;
}

export interface BotConfig {
  collector: CollectorConfig;
  dashboard: DashboardConfig;
  strategies: StrategiesConfig;
  trading: TradingConfig;
}

const DEFAULTS: BotConfig = {
  collector: {
    binance_ws_url: "wss://data-stream.binance.vision",
    chainlink_ws_url: "wss://ws-live-data.polymarket.com",
    gamma_url: "https://gamma-api.polymarket.com",
    clob_url: "https://clob.polymarket.com",
    ipc_path: defaultIpcPath(),
    data_dir: "./data",
  },
  dashboard: {
    bind: "0.0.0.0:3003",
    ipc_path: defaultIpcPath(),
    data_dir: "./data",
  },
  strategies: {
    shares: 5,
    dual_45c: { limit_price: 0.45 },
    momentum_90c: {
      limit_price: 0.90,
      window_secs: 3,
      signal_tail_secs: 180,
    },
    ptb_deviation: {
      limit_price: 0.99,
      signal_window_secs: 60,
    },
  },
  trading: {
    enabled: false,
    private_key: "",
    proxy_wallet_address: "",
    signature_type: 2,
    chain_id: 137,
    clob_url: "https://clob.polymarket.com",
    gamma_url: "https://gamma-api.polymarket.com",
  },
};

function envStr(key: string, fallback: string): string {
  const value = process.env[key]?.trim();
  return value ? value : fallback;
}

function envNum(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBool(key: string, fallback: boolean): boolean {
  const raw = process.env[key]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "true" || raw === "1" || raw === "yes";
}

/** Map env signature type to a supported Polymarket CLOB V2 value (0–3). */
export function normalizeSignatureType(n: number): number {
  return n;
}

function buildConfig(): BotConfig {
  const dataDir = envStr("DATA_DIR", DEFAULTS.collector.data_dir);
  const ipcPath = resolveIpcPath(process.env.IPC_PATH ?? DEFAULTS.collector.ipc_path);

  return {
    collector: {
      binance_ws_url: envStr("BINANCE_WS_URL", DEFAULTS.collector.binance_ws_url),
      chainlink_ws_url: envStr("CHAINLINK_WS_URL", DEFAULTS.collector.chainlink_ws_url),
      gamma_url: envStr("GAMMA_URL", DEFAULTS.collector.gamma_url),
      clob_url: envStr("CLOB_URL", DEFAULTS.collector.clob_url),
      ipc_path: ipcPath,
      data_dir: dataDir,
    },
    dashboard: {
      bind: envStr("DASHBOARD_BIND", DEFAULTS.dashboard.bind),
      ipc_path: ipcPath,
      data_dir: dataDir,
    },
    strategies: {
      shares: envNum("STRATEGY_SHARES", DEFAULTS.strategies.shares),
      dual_45c: {
        limit_price: envNum("DUAL_45C_LIMIT_PRICE", DEFAULTS.strategies.dual_45c.limit_price),
      },
      momentum_90c: {
        limit_price: envNum("MOMENTUM_90C_LIMIT_PRICE", DEFAULTS.strategies.momentum_90c.limit_price),
        window_secs: envNum("MOMENTUM_90C_WINDOW_SECS", DEFAULTS.strategies.momentum_90c.window_secs),
        signal_tail_secs: envNum(
          "MOMENTUM_90C_SIGNAL_TAIL_SECS",
          DEFAULTS.strategies.momentum_90c.signal_tail_secs,
        ),
      },
      ptb_deviation: {
        limit_price: envNum("PTB_DEVIATION_LIMIT_PRICE", DEFAULTS.strategies.ptb_deviation.limit_price),
        signal_window_secs: envNum(
          "PTB_DEVIATION_SIGNAL_WINDOW_SECS",
          DEFAULTS.strategies.ptb_deviation.signal_window_secs,
        ),
      },
    },
    trading: {
      enabled: envBool("LIVE_TRADING_ENABLED", DEFAULTS.trading.enabled),
      private_key: envStr("POLYMARKET_PRIVATE_KEY", DEFAULTS.trading.private_key),
      proxy_wallet_address: envStr("POLYMARKET_PROXY_WALLET", DEFAULTS.trading.proxy_wallet_address),
      signature_type: normalizeSignatureType(
        envNum("POLYMARKET_SIGNATURE_TYPE", DEFAULTS.trading.signature_type),
      ),
      chain_id: envNum("POLYMARKET_CHAIN_ID", DEFAULTS.trading.chain_id),
      clob_url: envStr("CLOB_URL", DEFAULTS.trading.clob_url),
      gamma_url: envStr("GAMMA_URL", DEFAULTS.trading.gamma_url),
    },
  };
}

/** Load configuration from a `.env` file and process environment variables. */
export function loadConfig(envPath = ".env"): BotConfig {
  const abs = resolve(envPath);
  const defaultEnv = resolve(".env");
  if (existsSync(abs)) {
    dotenv.config({ path: abs, override: false });
  } else if (abs !== defaultEnv) {
    throw new Error(`env file not found: ${abs}`);
  }
  return buildConfig();
}

/** Validate live-trading credentials before starting a live strategy runner. */
export function validateTradingConfig(tc: TradingConfig): string | null {
  if (!tc.enabled) return null;
  if (!tc.private_key.trim()) {
    return "LIVE_TRADING_ENABLED is true but POLYMARKET_PRIVATE_KEY is not set";
  }
  const sig = normalizeSignatureType(tc.signature_type);
  if (sig < 0 || sig > 3) {
    return `POLYMARKET_SIGNATURE_TYPE=${tc.signature_type} is unsupported (use 0, 1, 2, or 3)`;
  }
  if ((sig === 1 || sig === 2 || sig === 3) && !tc.proxy_wallet_address.trim()) {
    return "POLYMARKET_PROXY_WALLET is required for signature types 1 and 2";
  }
  return null;
}

export function tradingStatus(tc: TradingConfig): {
  enabled: boolean;
  mode: "paper" | "live";
  configured: boolean;
  has_private_key: boolean;
  has_proxy_wallet: boolean;
  signature_type: number;
  chain_id: number;
} {
  const hasPrivateKey = Boolean(tc.private_key.trim());
  const hasProxyWallet = Boolean(tc.proxy_wallet_address.trim());
  const configured =
    hasPrivateKey && (!tc.enabled || tc.signature_type === 0 || hasProxyWallet);
  const mode: "paper" | "live" = tc.enabled && hasPrivateKey ? "live" : "paper";

  return {
    enabled: tc.enabled,
    mode,
    configured,
    has_private_key: hasPrivateKey,
    has_proxy_wallet: hasProxyWallet,
    signature_type: tc.signature_type,
    chain_id: tc.chain_id,
  };
}
