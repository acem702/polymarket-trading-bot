import { resolve, dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { loadConfig, parseAsset, parseTimeFrame, tradingStatus, validateTradingConfig } from "@pmt/shared";
import { listStrategyDefaults, runStrategy, type StrategyRunRequest } from "./strategies.js";
import { ClobExecutor } from "./clob-executor.js";
import { LiveTradeHistory } from "./live-history.js";
import {
  LiveStrategyEngine,
  spawnFillPoller,
  spawnLiveEngineTicker,
  spawnSettlementReconciler,
} from "./live-engine.js";
import { RiskManager } from "./risk-manager.js";
import { ResultsLog } from "./results-log.js";
import {
  createLiveState,
  getWsFrame,
  listMarkets,
  listSlugDates,
  listSlugs,
  readAskBidHistory,
  readClPtbHistory,
  readOrderbookSnapshot,
  readPriceHistory,
  readPtbForSlug,
  readSpreadHistory,
  readSpreadLatest,
  spawnCollectorSubscriber,
  spawnStalenessWatchdog,
} from "./api.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = resolve(__dirname, "../static");

const program = new Command();
program
  .name("polypulse")
  .option("-e, --env <path>", "env file", ".env")
  .parse();

const opts = program.opts<{ env: string }>();
const cfg = loadConfig(resolve(opts.env));
const dc = cfg.dashboard;
const sc = cfg.strategies;
const tc = cfg.trading;

const live = createLiveState();
const clobExecutor = new ClobExecutor(tc);
await clobExecutor.init();
const liveHistory = new LiveTradeHistory(dc.data_dir);
const riskManager = new RiskManager(cfg.risk, join(dc.data_dir, "risk-state.json"));
const resultsLog = new ResultsLog(dc.data_dir);
const liveEngine = new LiveStrategyEngine(
  tc,
  clobExecutor,
  liveHistory,
  riskManager,
  resultsLog,
  join(dc.data_dir, "pending-settlements.json"),
);
spawnCollectorSubscriber(dc.ipc_path, live);
spawnStalenessWatchdog(live);
spawnLiveEngineTicker(live, liveEngine);
spawnFillPoller(liveEngine);
spawnSettlementReconciler(liveEngine);

const app = Fastify({
  logger: {
    base: { pid: process.pid },
  },
});

// ── API auth (D1) ───────────────────────────────────────────────────
// When DASHBOARD_TOKEN is set, /api + /ws require a matching bearer token
// (Authorization: Bearer <t> or ?token=<t>). Static files and /health stay open.
if (dc.token) {
  app.addHook("onRequest", async (req, reply) => {
    const url = req.url || "";
    if (!url.startsWith("/api") && !url.startsWith("/ws")) return;
    const auth = req.headers.authorization;
    const fromHeader =
      typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
    const q = req.query as { token?: string } | undefined;
    const provided = fromHeader ?? (typeof q?.token === "string" ? q.token : undefined);
    if (provided !== dc.token) {
      await reply.code(401).send({ error: "unauthorized" });
      return reply;
    }
  });
  app.log.info("API auth enabled (DASHBOARD_TOKEN set)");
} else {
  app.log.warn("API auth DISABLED — set DASHBOARD_TOKEN before exposing this instance publicly");
}

await app.register(fastifyStatic, {
  root: STATIC_DIR,
  prefix: "/",
});

await app.register(fastifyWebsocket);

app.get("/", async (_req, reply) => {
  const html = readFileSync(join(STATIC_DIR, "index.html"), "utf8");
  return reply.type("text/html").send(html);
});

app.get("/api/markets", async () => listMarkets(live));
app.get("/api/prices", async () => live.frame?.prices ?? {});
app.get<{
  Params: { asset: string; venue: string };
  Querystring: { limit?: string; from_ms?: string; to_ms?: string };
}>("/api/history/:asset/:venue", async (req) =>
  readPriceHistory(
    dc.data_dir,
    req.params.asset,
    req.params.venue,
    Number(req.query.limit ?? 600),
    req.query.from_ms ? Number(req.query.from_ms) : undefined,
    req.query.to_ms ? Number(req.query.to_ms) : undefined,
  ),
);
app.get<{
  Params: { asset: string; tf: string };
  Querystring: { limit?: string; from_ms?: string; to_ms?: string };
}>("/api/ptb_dev/:asset/:tf", async (req) =>
  readClPtbHistory(
    dc.data_dir,
    req.params.asset,
    req.params.tf,
    Number(req.query.limit ?? 500),
    req.query.from_ms ? Number(req.query.from_ms) : undefined,
    req.query.to_ms ? Number(req.query.to_ms) : undefined,
  ),
);
app.get<{
  Params: { asset: string };
  Querystring: { limit?: string; from_ms?: string; to_ms?: string };
}>("/api/spread/:asset", async (req) =>
  readSpreadHistory(
    dc.data_dir,
    req.params.asset,
    Number(req.query.limit ?? 500),
    req.query.from_ms ? Number(req.query.from_ms) : undefined,
    req.query.to_ms ? Number(req.query.to_ms) : undefined,
  ),
);
app.get("/api/spread/latest", async () => readSpreadLatest(dc.data_dir));
app.get<{
  Params: { asset: string; tf: string };
  Querystring: { limit?: string; date?: string };
}>("/api/slugs/:asset/:tf", async (req) => {
  const asset = parseAsset(req.params.asset);
  const tf = parseTimeFrame(req.params.tf);
  if (!asset || !tf) return [];
  return listSlugs(dc.data_dir, asset, tf, Number(req.query.limit ?? 500), req.query.date);
});
app.get<{ Params: { asset: string; tf: string } }>(
  "/api/slug_dates/:asset/:tf",
  async (req) => {
    const asset = parseAsset(req.params.asset);
    const tf = parseTimeFrame(req.params.tf);
    if (!asset || !tf) return [];
    return listSlugDates(dc.data_dir, asset, tf);
  },
);
app.get<{
  Params: { asset: string; tf: string };
  Querystring: { limit?: string; slug?: string };
}>("/api/ask_bid_history/:asset/:tf", async (req) =>
  readAskBidHistory(
    dc.data_dir,
    req.params.asset,
    req.params.tf,
    Number(req.query.limit ?? 5000),
    req.query.slug,
  ),
);
app.get<{ Params: { asset: string; tf: string }; Querystring: { slug: string } }>(
  "/api/ptb/:asset/:tf",
  async (req) => {
    if (!req.query.slug) return null;
    return readPtbForSlug(dc.data_dir, req.params.asset, req.params.tf, req.query.slug);
  },
);
app.get<{ Params: { asset: string; tf: string; slug: string } }>(
  "/api/orderbook/:asset/:tf/:slug",
  async (req) => readOrderbookSnapshot(dc.data_dir, req.params.asset, req.params.tf, req.params.slug),
);

app.get("/api/strategies", async () => listStrategyDefaults(sc));

app.get("/api/trading/status", async () => ({
  ...tradingStatus(tc),
  executor: clobExecutor.status(),
  risk: riskManager.snapshot(),
}));

app.get("/api/risk", async () => riskManager.snapshot());

app.get("/health", async () => {
  const mem = process.memoryUsage();
  return {
    ok: true,
    uptime_s: Math.round(process.uptime()),
    rss_mb: Math.round(mem.rss / 1048576),
    heap_used_mb: Math.round(mem.heapUsed / 1048576),
    collector_connected: live.connected,
    last_frame_age_ms: live.lastUpdateMs ? Date.now() - live.lastUpdateMs : null,
  };
});

// Heap/feed heartbeat for long unattended runs.
setInterval(() => {
  const mem = process.memoryUsage();
  app.log.info(
    {
      rss_mb: Math.round(mem.rss / 1048576),
      heap_mb: Math.round(mem.heapUsed / 1048576),
      collector_connected: live.connected,
    },
    "health",
  );
}, 60_000);

app.post<{ Body: import("./strategies.js").StrategyRunRequest }>(
  "/api/strategies/run",
  async (req, reply) => {
    try {
      const body = req.body ?? {};
      if (!body.strategy || !body.asset || !body.tf) {
        return reply.status(400).send({ error: "strategy, asset, and tf are required" });
      }
      return runStrategy(dc.data_dir, body, sc);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  },
);

app.get("/api/strategies/live", async () => liveEngine.list());

app.get<{ Querystring: { asset?: string; tf?: string; strategy?: string; mode?: string; limit?: string } }>(
  "/api/strategies/results",
  async (req) => {
    const q = {
      asset: req.query.asset,
      tf: req.query.tf,
      strategy: req.query.strategy,
      mode: req.query.mode,
    };
    return {
      summary: resultsLog.summary(q),
      recent: resultsLog.list(q, req.query.limit ? Number(req.query.limit) : 30),
    };
  },
);

app.get<{ Querystring: { strategy?: string; asset?: string; tf?: string; limit?: string } }>(
  "/api/strategies/live/history",
  async (req) =>
    liveEngine.tradeHistory({
      strategy: req.query.strategy,
      asset: req.query.asset,
      tf: req.query.tf,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    }),
);

app.get<{ Params: { strategy: string; asset: string; tf: string } }>(
  "/api/strategies/live/:strategy/:asset/:tf",
  async (req) => liveEngine.get(req.params.strategy, req.params.asset, req.params.tf),
);

app.post<{ Body: StrategyRunRequest }>(
  "/api/strategies/live/start",
  async (req, reply) => {
    try {
      const body = req.body ?? {};
      if (!body.strategy || !body.asset || !body.tf) {
        return reply.status(400).send({ error: "strategy, asset, and tf are required" });
      }
      const tradingErr = validateTradingConfig(tc);
      if (tradingErr) {
        return reply.status(400).send({ error: tradingErr });
      }
      if (tc.enabled && !clobExecutor.isLive()) {
        const ex = clobExecutor.status();
        return reply.status(400).send({
          error: ex.initError ?? "CLOB client failed to initialize — check wallet credentials",
        });
      }
      return liveEngine.start(body);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.status(400).send({ error: msg });
    }
  },
);

app.post<{ Body: { strategy: string; asset: string; tf: string } }>(
  "/api/strategies/live/stop",
  async (req, reply) => {
    const body = req.body ?? {};
    if (!body.strategy || !body.asset || !body.tf) {
      return reply.status(400).send({ error: "strategy, asset, and tf are required" });
    }
    const result = await liveEngine.stop(body.strategy, body.asset, body.tf);
    if (!result) return reply.status(404).send({ error: "live runner not found" });
    return result;
  },
);

app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    const send = () => {
      const frame = getWsFrame(live);
      // Skip if the client is backed up, so a slow tab can't buffer us to OOM.
      if (frame && socket.readyState === 1 && socket.bufferedAmount < 1_000_000) {
        socket.send(JSON.stringify(frame));
      }
    };
    send();
    const interval = setInterval(send, 200);
    socket.on("close", () => clearInterval(interval));
    socket.on("error", () => clearInterval(interval));
  });
});

await app.listen({ host: "0.0.0.0", port: Number(dc.bind.split(":")[1] ?? 3003) });
app.log.info(`PolyPulse dashboard listening on http://${dc.bind}`);
