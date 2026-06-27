/**
 * Settlement audit / reconciliation tool.
 *
 * Fetches Polymarket's OFFICIAL resolved outcome for every recorded period and
 * compares it to the locally-computed `direction` field. Reports the
 * disagreement rate and writes the ground truth to
 * `data/settlements/<asset>_<tf>.json`, which the backtest then prefers.
 *
 * Usage:
 *   tsx packages/strategies/src/audit-settlement.ts <ASSET> <TF> [--data ./data] [--gamma URL] [--limit N]
 *   e.g. tsx packages/strategies/src/audit-settlement.ts BTC 5m
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  ALL_ASSETS,
  ALL_TIMEFRAMES,
  fetchSettledOutcome,
  type Asset,
  type TimeFrame,
} from "@pmt/shared";
import { marketDataPath, settlementsPath } from "./loader.js";

interface RecordedPeriod {
  slug: string;
  period_start: number;
  direction: "up" | "down";
}

/** Read recorded periods straight from disk (deduped to first occurrence). */
function readRecorded(dataDir: string, asset: Asset, tf: TimeFrame): RecordedPeriod[] {
  const path = marketDataPath(dataDir, asset, tf);
  if (!existsSync(path)) return [];
  const seen = new Set<number>();
  const out: RecordedPeriod[] = [];
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as Record<string, unknown>;
      if (r.direction !== "up" && r.direction !== "down") continue;
      const ps = Number(r.period_start);
      if (!ps || seen.has(ps)) continue;
      seen.add(ps);
      out.push({ slug: String(r.slug), period_start: ps, direction: r.direction });
    } catch {
      // skip
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function audit(
  dataDir: string,
  asset: Asset,
  tf: TimeFrame,
  gammaUrl: string,
  limit: number,
): Promise<void> {
  const recorded = readRecorded(dataDir, asset, tf);
  if (!recorded.length) {
    console.log(`[${asset} ${tf}] no recorded periods — nothing to audit`);
    return;
  }
  const slice = recorded.slice(-limit);
  console.log(`[${asset} ${tf}] auditing ${slice.length} periods against ${gammaUrl}\n`);

  const outcomes: Record<string, "up" | "down"> = {};
  let agree = 0;
  let disagree = 0;
  let unresolved = 0;
  const mismatches: string[] = [];

  for (const p of slice) {
    const result = await fetchSettledOutcome(gammaUrl, p.slug);
    await sleep(120); // be polite to the API
    if (!result) {
      unresolved++;
      continue;
    }
    outcomes[String(p.period_start)] = result.outcome;
    if (result.outcome === p.direction) {
      agree++;
    } else {
      disagree++;
      mismatches.push(
        `  ${p.slug}  recorded=${p.direction}  official=${result.outcome}  prices=[${result.prices.join(",")}]`,
      );
    }
  }

  const resolved = agree + disagree;
  console.log(`resolved:   ${resolved}/${slice.length}`);
  console.log(`agree:      ${agree}`);
  console.log(`DISAGREE:   ${disagree}${resolved ? `  (${((disagree / resolved) * 100).toFixed(1)}% of resolved)` : ""}`);
  console.log(`unresolved: ${unresolved} (market not found / not closed / tie)`);
  if (mismatches.length) {
    console.log(`\nmismatches:\n${mismatches.join("\n")}`);
  }

  if (Object.keys(outcomes).length) {
    const path = settlementsPath(dataDir, asset, tf);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ asset, tf, updated_ms: Date.now(), outcomes }, null, 2),
    );
    console.log(`\nwrote ${Object.keys(outcomes).length} official outcomes → ${path}`);
  } else {
    console.log(`\nno official outcomes resolved — cache not written`);
  }
}

function parseArgs(argv: string[]): {
  asset: string;
  tf: string;
  dataDir: string;
  gammaUrl: string;
  limit: number;
} {
  const positional: string[] = [];
  let dataDir = "./data";
  let gammaUrl = process.env.GAMMA_URL ?? "https://gamma-api.polymarket.com";
  let limit = 1000;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--data") dataDir = argv[++i] ?? dataDir;
    else if (a === "--gamma") gammaUrl = argv[++i] ?? gammaUrl;
    else if (a === "--limit") limit = Number(argv[++i] ?? limit) || limit;
    else positional.push(a);
  }
  return { asset: positional[0] ?? "", tf: positional[1] ?? "", dataDir, gammaUrl, limit };
}

async function main(): Promise<void> {
  const { asset, tf, dataDir, gammaUrl, limit } = parseArgs(process.argv.slice(2));
  if (!asset || !tf) {
    console.error("usage: audit-settlement <ASSET> <TF> [--data ./data] [--gamma URL] [--limit N]");
    console.error(`  ASSET: ${ALL_ASSETS.join(", ")}`);
    console.error(`  TF:    ${ALL_TIMEFRAMES.join(", ")}`);
    process.exit(1);
  }
  if (!ALL_ASSETS.includes(asset as Asset)) {
    console.error(`unknown asset "${asset}" (expected one of ${ALL_ASSETS.join(", ")})`);
    process.exit(1);
  }
  if (!ALL_TIMEFRAMES.includes(tf as TimeFrame)) {
    console.error(`unknown tf "${tf}" (expected one of ${ALL_TIMEFRAMES.join(", ")})`);
    process.exit(1);
  }
  await audit(dataDir, asset as Asset, tf as TimeFrame, gammaUrl, limit);
}

void main();
