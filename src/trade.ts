import { randomUUID } from "crypto";
import { OrdersApi } from "kalshi-typescript";
import { config } from "./config";
import { buildKalshiConfiguration, getMarketApi } from "./kalshi";

function dollarsToCents(s: string | undefined): number {
  if (s == null || s === "") return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export interface YesNoQuoteCents {
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
}

export async function getYesNoQuoteCents(ticker: string): Promise<YesNoQuoteCents | null> {
  if (config.mockMode) {
    return { yesBid: 45, yesAsk: 47, noBid: 53, noAsk: 55 };
  }
  const api = getMarketApi();
  const res = await api.getMarket(ticker);
  const m = res.data.market;
  if (!m) return null;
  return {
    yesBid: dollarsToCents(m.yes_bid_dollars),
    yesAsk: dollarsToCents(m.yes_ask_dollars),
    noBid: dollarsToCents(m.no_bid_dollars),
    noAsk: dollarsToCents(m.no_ask_dollars),
  };
}

/**
 * Limit price for a BUY in cents (1–99).
 * - taker: near ask (+ buffer) so the order is likely to execute (still a limit order).
 * - maker: bid + 1 with post_only so it rests (may not fill).
 */
export function limitPriceForBuy(
  side: "yes" | "no",
  q: YesNoQuoteCents,
  execution: "taker" | "maker",
  bufferCents: number
): { priceCents: number; postOnly: boolean } {
  if (side === "yes") {
    if (execution === "taker") {
      const base = q.yesAsk > 0 ? q.yesAsk : q.yesBid;
      const p = base > 0 ? Math.min(99, base + bufferCents) : 50;
      return { priceCents: Math.max(1, p), postOnly: false };
    }
    const p = q.yesBid > 0 ? Math.min(99, q.yesBid + 1) : 1;
    return { priceCents: Math.max(1, p), postOnly: true };
  }
  if (execution === "taker") {
    const base = q.noAsk > 0 ? q.noAsk : q.noBid;
    const p = base > 0 ? Math.min(99, base + bufferCents) : 50;
    return { priceCents: Math.max(1, p), postOnly: false };
  }
  const p = q.noBid > 0 ? Math.min(99, q.noBid + 1) : 1;
  return { priceCents: Math.max(1, p), postOnly: true };
}

export async function placeKalshiLimitOrder(params: {
  ticker: string;
  side: "yes" | "no";
  count: number;
  priceCents: number;
  postOnly: boolean;
  dryRun: boolean;
}): Promise<{ ok: boolean; orderId?: string; error?: string }> {
  const price = Math.max(1, Math.min(99, Math.round(params.priceCents)));
  const count = Math.max(1, params.count);

  if (params.dryRun || config.mockMode) {
    const msg = `[TRADE DRY RUN] buy ${params.side} ${params.ticker} count=${count} @${price}c postOnly=${params.postOnly}`;
    console.log(msg);
    return { ok: true, orderId: "dry-run" };
  }

  const ordersApi = new OrdersApi(buildKalshiConfiguration());
  try {
    const res = await ordersApi.createOrder({
      ticker: params.ticker,
      side: params.side,
      action: "buy",
      count,
      time_in_force: "good_till_canceled",
      post_only: params.postOnly,
      client_order_id: randomUUID(),
      ...(params.side === "yes" ? { yes_price: price } : { no_price: price }),
    });
    const id = res.data.order?.order_id ?? "unknown";
    return { ok: true, orderId: id };
  } catch (e) {
    const err = e instanceof Error ? e.message : String(e);
    return { ok: false, error: err };
  }
}
