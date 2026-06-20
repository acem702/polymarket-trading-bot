import {
  ClobClient,
  OrderType,
  Side,
  SignatureTypeV2,
  type OrderResponse,
} from "@polymarket/clob-client-v2";
import { Wallet } from "ethers";
import type { TradingConfig } from "@pmt/shared";

export interface PlaceOrderResult {
  ok: boolean;
  orderId?: string;
  error?: string;
  raw?: unknown;
}

export interface ClobExecutorStatus {
  mode: "paper" | "live";
  ready: boolean;
  initError: string | null;
  clobVersion: number | null;
  sdk: string;
}

function parseSignatureType(n: number): SignatureTypeV2 {
  if (n === 0) return SignatureTypeV2.EOA;
  if (n === 1) return SignatureTypeV2.POLY_PROXY;
  if (n === 2) return SignatureTypeV2.POLY_GNOSIS_SAFE;
  if (n === 3) return SignatureTypeV2.POLY_1271;
  throw new Error(`unsupported POLYMARKET_SIGNATURE_TYPE=${n} (use 0–3)`);
}

function normalizePrivateKey(pk: string): string {
  const trimmed = pk.trim().replace(/^["']|["']$/g, "");
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function extractOrderIdFromText(msg: string): string | undefined {
  for (const needle of ['"orderID":"', '"order_id":"']) {
    const start = msg.indexOf(needle);
    if (start === -1) continue;
    const rest = msg.slice(start + needle.length);
    const end = rest.indexOf('"');
    const id = rest.slice(0, end).trim();
    if (id) return id;
  }
  return undefined;
}

function parseOrderResponse(resp: unknown): PlaceOrderResult {
  if (!resp || typeof resp !== "object") {
    return { ok: false, error: "empty CLOB response", raw: resp };
  }

  const r = resp as OrderResponse & Record<string, unknown>;

  if (typeof r.error === "string" && r.error) {
    return { ok: false, error: r.error, raw: resp };
  }
  if (r.error && typeof r.error === "object") {
    const nested = r.error as Record<string, unknown>;
    const nestedErr =
      (typeof nested.error === "string" && nested.error)
      || (typeof nested.message === "string" && nested.message)
      || JSON.stringify(nested);
    return { ok: false, error: nestedErr, raw: resp };
  }

  const orderId =
    (typeof r.orderID === "string" && r.orderID)
    || (typeof r.order_id === "string" && r.order_id)
    || (typeof r.id === "string" && r.id)
    || undefined;

  const errorMsg =
    (typeof r.errorMsg === "string" && r.errorMsg)
    || (typeof r.message === "string" && r.message)
    || undefined;

  if (r.success === false) {
    return {
      ok: false,
      orderId,
      error: errorMsg || "order rejected by CLOB",
      raw: resp,
    };
  }

  if (errorMsg && !orderId) {
    return { ok: false, error: errorMsg, raw: resp };
  }

  if (orderId) {
    return { ok: true, orderId, raw: resp };
  }

  if (r.success === true) {
    return { ok: true, raw: resp };
  }

  return { ok: false, error: errorMsg ?? "order failed (no order id)", raw: resp };
}

export class ClobExecutor {
  private client: ClobClient | null = null;
  private ready = false;
  private initError: string | null = null;
  private mode: "paper" | "live" = "paper";
  private clobVersion: number | null = null;

  constructor(private readonly cfg: TradingConfig) {}

  async init(): Promise<void> {
    if (!this.cfg.enabled || !this.cfg.private_key.trim()) {
      this.mode = "paper";
      this.ready = false;
      return;
    }

    try {
      const wallet = new Wallet(normalizePrivateKey(this.cfg.private_key));
      const signatureType = parseSignatureType(this.cfg.signature_type);
      const funderAddress = this.cfg.proxy_wallet_address.trim() || undefined;

      const bootstrap = new ClobClient({
        host: this.cfg.clob_url,
        chain: this.cfg.chain_id,
        signer: wallet,
      });
      const creds = await bootstrap.createOrDeriveApiKey();

      this.client = new ClobClient({
        host: this.cfg.clob_url,
        chain: this.cfg.chain_id,
        signer: wallet,
        creds,
        signatureType,
        funderAddress,
        useServerTime: true,
      });
      this.clobVersion = await this.client.getVersion();
      this.ready = true;
      this.mode = "live";
      this.initError = null;
    } catch (err) {
      this.client = null;
      this.ready = false;
      this.mode = "paper";
      this.initError = err instanceof Error ? err.message : String(err);
    }
  }

  status(): ClobExecutorStatus {
    return {
      mode: this.mode,
      ready: this.ready,
      initError: this.initError,
      clobVersion: this.clobVersion,
      sdk: "@polymarket/clob-client-v2",
    };
  }

  isLive(): boolean {
    return this.mode === "live" && this.ready && this.client !== null;
  }

  /** Cache tick size / neg-risk metadata before first order (see open-limit-bot). */
  async prewarmToken(tokenId: string): Promise<void> {
    if (!this.client || !tokenId) return;
    try {
      await this.client.getTickSize(tokenId);
      await this.client.getNegRisk(tokenId);
    } catch {
      // non-fatal; createOrder resolves these again
    }
  }

  /** Polymarket GTD requires wire expiration ≥ now + 60s. */
  private gtdExpiration(restSecs: number): number {
    return Math.floor(Date.now() / 1000) + 60 + Math.max(1, Math.ceil(restSecs));
  }

  async placeLimitBuy(
    tokenId: string,
    price: number,
    size: number,
    opts?: { restSecs?: number },
  ): Promise<PlaceOrderResult> {
    if (!this.isLive() || !this.client) {
      return { ok: false, error: "paper mode — order not sent" };
    }
    if (!tokenId) {
      return { ok: false, error: "missing token id" };
    }

    await this.prewarmToken(tokenId);

    const restSecs = opts?.restSecs;
    const orderType = restSecs !== undefined ? OrderType.GTD : OrderType.GTC;
    const userOrder: {
      tokenID: string;
      price: number;
      side: Side;
      size: number;
      expiration?: number;
    } = {
      tokenID: tokenId,
      price,
      side: Side.BUY,
      size,
    };
    if (restSecs !== undefined) {
      userOrder.expiration = this.gtdExpiration(restSecs);
    }

    try {
      const resp = await this.client.createAndPostOrder(
        userOrder,
        undefined,
        orderType,
      );
      return parseOrderResponse(resp);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const orderId = extractOrderIdFromText(msg);
      if (orderId) {
        return { ok: true, orderId, error: msg };
      }
      return { ok: false, error: msg };
    }
  }
}
