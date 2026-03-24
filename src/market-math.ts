import type { Market } from "kalshi-typescript";

export function parseDollars(s: string | undefined): number | null {
  if (s == null || s === "") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/** Implied YES probability from mid of bid/ask; fallback to last trade. */
export function impliedYesProb(m: Market): number | null {
  const bid = parseDollars(m.yes_bid_dollars);
  const ask = parseDollars(m.yes_ask_dollars);
  const last = parseDollars(m.last_price_dollars);
  if (bid != null && ask != null && bid > 0 && ask > 0 && ask >= bid) {
    return (bid + ask) / 2;
  }
  if (last != null && last > 0) return last;
  if (ask != null && ask > 0) return ask;
  if (bid != null && bid > 0) return bid;
  return null;
}
