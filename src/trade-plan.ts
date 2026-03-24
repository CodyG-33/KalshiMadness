import type { DiscrepancyAlert } from "./scanner";

export interface PlannedOrder {
  ticker: string;
  side: "yes" | "no";
  reason: string;
  alertType: string;
}

/**
 * Map scanner alerts to a single BUY leg each (heuristic, not arbitrage).
 * You are responsible for economic sense and settlement rules.
 */
export function planOrdersFromAlerts(
  alerts: DiscrepancyAlert[],
  allowedTypes: Set<string>
): PlannedOrder[] {
  const out: PlannedOrder[] = [];

  for (const alert of alerts) {
    if (!allowedTypes.has(alert.type)) continue;

    switch (alert.type) {
      case "equiv_gap": {
        const pa = alert.a.pYes;
        const pb = alert.b.pYes;
        if (pa == null || pb == null) break;
        if (pa === pb) break;
        const cheaper = pa < pb ? alert.a : alert.b;
        out.push({
          ticker: cheaper.market.ticker,
          side: "yes",
          reason: `equiv_gap: lower implied YES on ${cheaper.market.ticker}`,
          alertType: alert.type,
        });
        break;
      }
      case "ordering_violation": {
        const advance = alert.a.kind === "advance" ? alert.a : alert.b;
        if (advance.kind !== "advance") break;
        out.push({
          ticker: advance.market.ticker,
          side: "no",
          reason: "ordering_violation: P(advance)>P(win) — heuristic NO on advance market",
          alertType: alert.type,
        });
        break;
      }
      case "advance_monotonicity": {
        out.push({
          ticker: alert.a.market.ticker,
          side: "no",
          reason: "advance_monotonicity: P(deeper)>P(shallower) — heuristic NO on deeper advance",
          alertType: alert.type,
        });
        break;
      }
      default:
        break;
    }
  }

  return out;
}
