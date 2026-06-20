import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Command } from "commander/esm.mjs";
import pino from "pino";
import {
  ALL_ASSETS,
  ALL_TIMEFRAMES,
  JsonlWriter,
  loadConfig,
  nowMs,
  tfFolder,
  type Asset,
} from "@pmt/shared";
import { IpcServer } from "./ipc-server.js";
import { CollectorState } from "./state.js";
import { spawnBinance } from "./feeds/binance.js";
import { spawnChainlink } from "./feeds/chainlink.js";
import { spawnMarketResolve } from "./feeds/market-resolve.js";
import { spawnClobManager } from "./feeds/polymarket-clob.js";

const log = pino({ level: process.env.LOG_LEVEL ?? "info", base: { pid: process.pid } });

async function ensureDirs(dataDir: string): Promise<void> {
  for (const venue of ["binance", "chainlink"]) {
    mkdirSync(`${dataDir}/prices/${venue}`, { recursive: true });
  }
  for (const tf of ALL_TIMEFRAMES) {
    for (const asset of ALL_ASSETS) {
      for (const top of ["order_books", "ask_bid_prices", "market_data"]) {
        mkdirSync(`${dataDir}/${top}/${tfFolder(tf)}/${asset}`, { recursive: true });
      }
    }
  }
  mkdirSync(`${dataDir}/spread/binance_chainlink`, { recursive: true });
  mkdirSync(`${dataDir}/spread/cl_ptb_deviation`, { recursive: true });
}

const program = new Command();
program
  .name("polypulse-collector")
  .option("-e, --env <path>", "env file", ".env")
  .parse();

const opts = program.opts<{ env: string }>();
const cfg = loadConfig(resolve(opts.env));
const cc = cfg.collector;

log.info({ dataDir: cc.data_dir }, "PolyPulse collector starting");
await ensureDirs(cc.data_dir);

const marketDataWriters = new Map<string, JsonlWriter>();
for (const tf of ALL_TIMEFRAMES) {
  for (const asset of ALL_ASSETS) {
    const key = `${asset}_${tf}`;
    marketDataWriters.set(key, JsonlWriter.open(
      `${cc.data_dir}/market_data/${tfFolder(tf)}/${asset}/${tf}.jsonl`,
    ));
  }
}

const state = new CollectorState((evt) => {
  const ptbVenue = evt.tf === "1h" ? "Binance" : "Chainlink";
  const book = evt.final_book;
  const record = {
    ts_ms: evt.ts_ms,
    asset: evt.asset,
    tf: evt.tf,
    slug: evt.slug,
    period_start: evt.period_start,
    period_end: evt.new_period_start,
    ptb_venue: ptbVenue,
    open_price: evt.open_price,
    close_price: evt.close_price,
    direction: evt.direction,
    yes_best_bid: parseFloat(book?.yes_bids[0]?.price ?? "0"),
    yes_best_ask: parseFloat(book?.yes_asks[0]?.price ?? "0"),
    no_best_bid: parseFloat(book?.no_bids[0]?.price ?? "0"),
    no_best_ask: parseFloat(book?.no_asks[0]?.price ?? "0"),
  };
  marketDataWriters.get(`${evt.asset}_${evt.tf}`)?.write(record);
  log.info({
    asset: evt.asset, tf: evt.tf, slug: evt.slug,
    open: evt.open_price, close: evt.close_price, dir: evt.direction,
  }, "settlement");
});

const ipc = IpcServer.bind(cc.ipc_path);

const binanceWriters = new Map<Asset, JsonlWriter>();
const chainlinkWriters = new Map<Asset, JsonlWriter>();
const binClWriters = new Map<Asset, JsonlWriter>();
const clPtbWriters = new Map<string, JsonlWriter>();

for (const asset of ALL_ASSETS) {
  binanceWriters.set(asset, JsonlWriter.open(`${cc.data_dir}/prices/binance/${asset}.jsonl`));
  chainlinkWriters.set(asset, JsonlWriter.open(`${cc.data_dir}/prices/chainlink/${asset}.jsonl`));
  binClWriters.set(asset, JsonlWriter.open(`${cc.data_dir}/spread/binance_chainlink/${asset}.jsonl`));
}
for (const tf of ALL_TIMEFRAMES) {
  for (const asset of ALL_ASSETS) {
    const key = `${asset}_${tf}`;
    clPtbWriters.set(key, JsonlWriter.open(`${cc.data_dir}/spread/cl_ptb_deviation/${key}.jsonl`));
  }
}

const latestSpreadPath = `${cc.data_dir}/spread/latest.json`;
const marketCache = spawnMarketResolve(cc.gamma_url, cc.clob_url);
const chainlinkReconnect = { value: false };

spawnChainlink(cc.chainlink_ws_url, state, chainlinkWriters, log, chainlinkReconnect);
spawnBinance(cc.binance_ws_url, state, binanceWriters, log);
spawnClobManager(marketCache, state, cc.data_dir, log);

setInterval(() => {
  const frame = state.buildFrame();
  ipc.broadcast(frame);

  for (const sp of Object.values(frame.binance_chainlink_spread)) {
    binClWriters.get(sp.asset)?.write(sp);
  }
  for (const [key, dev] of Object.entries(frame.cl_ptb_deviation)) {
    clPtbWriters.get(key)?.write(dev);
  }

  writeFileSync(latestSpreadPath, JSON.stringify({
    ts_ms: frame.ts_ms,
    binance_chainlink: Object.values(frame.binance_chainlink_spread),
  }, null, 2));
}, 200);

setInterval(() => {
  const now = nowMs();
  for (const [, ts] of state.chainlink_tick_ts_ms) {
    if ((now - ts) / 1000 > 45) chainlinkReconnect.value = true;
  }
}, 15_000);

log.info("collector running — press Ctrl-C to stop");
process.on("SIGINT", () => {
  log.info("collector shutdown");
  process.exit(0);
});
