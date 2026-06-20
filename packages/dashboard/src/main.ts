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
import { LiveStrategyEngine, spawnLiveEngineTicker } from "./live-engine.js";
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
const liveEngine = new LiveStrategyEngine(tc, clobExecutor, liveHistory);
spawnCollectorSubscriber(dc.ipc_path, live);
spawnStalenessWatchdog(live);
spawnLiveEngineTicker(live, liveEngine);

const app = Fastify({
  logger: {
    base: { pid: process.pid },
  },
});

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
}));

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
    const result = liveEngine.stop(body.strategy, body.asset, body.tf);
    if (!result) return reply.status(404).send({ error: "live runner not found" });
    return result;
  },
);

app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    const send = () => {
      const frame = getWsFrame(live);
      if (frame && socket.readyState === 1) {
        socket.send(JSON.stringify(frame));
      }
    };
    send();
    const interval = setInterval(send, 200);
    socket.on("close", () => clearInterval(interval));
  });
});

await app.listen({ host: "0.0.0.0", port: Number(dc.bind.split(":")[1] ?? 3003) });
app.log.info(`PolyPulse dashboard listening on http://${dc.bind}`);
