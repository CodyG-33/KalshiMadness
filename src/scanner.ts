import type { Market } from "kalshi-typescript";
import { config } from "./config";
import { classifyMarketKind, teamFingerprint, type MarketKind } from "./classify-market";
import { fetchAllScanMarkets } from "./fetch-markets";
import { impliedYesProb } from "./market-math";
import {
  type BracketRound,
  type PropBucket,
  classifyPropBucket,
  correlationNotes,
  extractBracketRound,
  extractCountHints,
  extractSeedHints,
  CORRELATION_PLAYBOOK,
} from "./tournament-props";

export interface AnnotatedMarket {
  market: Market;
  kind: MarketKind;
  propBucket: PropBucket;
  bracketRound: BracketRound;
  seedHints: number[];
  countHints: number[];
  teamKey: string;
  pYes: number | null;
}

export type AlertType = "equiv_gap" | "ordering_violation" | "advance_monotonicity";

export interface DiscrepancyAlert {
  type: AlertType;
  detail: string;
  a: AnnotatedMarket;
  b: AnnotatedMarket;
}

/** Deeper rounds need more wins; used for advance-to-Round-X monotonicity. */
function advanceDepth(r: BracketRound): number | null {
  switch (r) {
    case "r32":
      return 1;
    case "s16":
      return 2;
    case "e8":
      return 3;
    case "f4":
      return 4;
    case "r64":
      return 0;
    default:
      return null;
  }
}

function annotate(m: Market): AnnotatedMarket {
  const kind = classifyMarketKind(m);
  return {
    market: m,
    kind,
    propBucket: classifyPropBucket(m, kind),
    bracketRound: extractBracketRound(m),
    seedHints: extractSeedHints(m),
    countHints: extractCountHints(m),
    teamKey: teamFingerprint(m),
    pYes: impliedYesProb(m),
  };
}

function groupBy<K, V>(items: V[], keyFn: (v: V) => K): Map<K, V[]> {
  const map = new Map<K, V[]>();
  for (const item of items) {
    const k = keyFn(item);
    const list = map.get(k) ?? [];
    list.push(item);
    map.set(k, list);
  }
  return map;
}

/**
 * Find pairs that may be economically linked (same team fingerprint, different kinds).
 * Heuristic only — confirm rules and settlement text before trading.
 */
export function findDiscrepancies(markets: Market[]): DiscrepancyAlert[] {
  const ann = markets.map(annotate);
  const alerts: DiscrepancyAlert[] = [];

  const byTeam = groupBy(ann, (x) => x.teamKey);
  for (const [teamKey, group] of byTeam) {
    if (!teamKey || teamKey.length < 3 || group.length < 2) continue;

    const advances = group.filter((x) => x.kind === "advance");
    const wins = group.filter((x) => x.kind === "single_game_win");

    for (const a of advances) {
      for (const b of wins) {
        const pa = a.pYes;
        const pb = b.pYes;
        if (pa == null || pb == null) continue;

        // Nested bracket logic: P(advance to later round) should not exceed P(win this game)
        // when "advance" is strictly downstream of that game (heuristic; false positives possible).
        if (pa > pb + config.maxAdvanceOverWin) {
          alerts.push({
            type: "ordering_violation",
            detail: `P(advance)=${pa.toFixed(3)} > P(win)=${pb.toFixed(3)} by > ${config.maxAdvanceOverWin}`,
            a,
            b,
          });
        }

        // If both describe the same effective event, prices should be close.
        const gap = Math.abs(pa - pb);
        if (gap >= config.minEquivProbGap) {
          alerts.push({
            type: "equiv_gap",
            detail: `|P(advance) - P(win)| = ${gap.toFixed(3)} ≥ ${config.minEquivProbGap}`,
            a,
            b,
          });
        }
      }
    }

    // Same kind but duplicated narratives (rare): large gap between two "win" lines same team
    const sameKind = (k: MarketKind) => group.filter((x) => x.kind === k);
    for (const kind of ["single_game_win", "advance"] as const) {
      const g = sameKind(kind);
      if (g.length < 2) continue;
      for (let i = 0; i < g.length; i++) {
        for (let j = i + 1; j < g.length; j++) {
          const x = g[i];
          const y = g[j];
          if (x.pYes == null || y.pYes == null) continue;
          const gap = Math.abs(x.pYes - y.pYes);
          if (gap >= config.minEquivProbGap) {
            alerts.push({
              type: "equiv_gap",
              detail: `Same kind "${kind}" |Δp|=${gap.toFixed(3)} — possible duplicate / mismatch`,
              a: x,
              b: y,
            });
          }
        }
      }
    }
  }

  // Same team, two "advance to Round X" lines: P(deeper) ≤ P(shallower) on one path
  for (const [, group] of byTeam) {
    const adv = group.filter((x) => x.kind === "advance");
    if (adv.length < 2) continue;
    for (let i = 0; i < adv.length; i++) {
      for (let j = i + 1; j < adv.length; j++) {
        const x = adv[i];
        const y = adv[j];
        const dx = advanceDepth(x.bracketRound);
        const dy = advanceDepth(y.bracketRound);
        if (dx == null || dy == null || dx === dy) continue;
        const deeper = dx > dy ? x : y;
        const shallower = dx > dy ? y : x;
        const dd = deeper.pYes;
        const ds = shallower.pYes;
        if (dd == null || ds == null) continue;
        if (dd > ds + config.maxAdvanceOverWin) {
          alerts.push({
            type: "advance_monotonicity",
            detail: `P(advance ${deeper.bracketRound})=${dd.toFixed(3)} > P(advance ${shallower.bracketRound})=${ds.toFixed(3)} — expect P(deeper) ≤ P(shallower)`,
            a: deeper,
            b: shallower,
          });
        }
      }
    }
  }

  return alerts;
}

export interface ScanReport {
  markets: AnnotatedMarket[];
  byEvent: Map<string, AnnotatedMarket[]>;
  /** Grouped props for cross-checking game lines vs aggregates (E8, S16, etc.) */
  byPropBucket: Map<PropBucket, AnnotatedMarket[]>;
  alerts: DiscrepancyAlert[];
}

export async function runScan(): Promise<ScanReport> {
  const markets = await fetchAllScanMarkets();
  const annotated = markets.map(annotate);
  const byEvent = groupBy(annotated, (x) => x.market.event_ticker);
  const byPropBucket = groupBy(annotated, (x) => x.propBucket);
  const alerts = findDiscrepancies(markets);
  return { markets: annotated, byEvent, byPropBucket, alerts };
}

function formatAnnotatedLine(x: AnnotatedMarket): string {
  const seeds = x.seedHints.length ? ` seeds=[${x.seedHints.join(",")}]` : "";
  const counts = x.countHints.length ? ` counts=[${x.countHints.join(",")}]` : "";
  return `  - ${x.market.ticker} | ${x.propBucket} | round=${x.bracketRound} | kind=${x.kind} | p≈${x.pYes?.toFixed(3) ?? "?"}${seeds}${counts} | ${x.market.yes_sub_title || x.market.title}`;
}

/** Short summary for Telegram (full console report may be huge). */
export function formatScanSummaryForTelegram(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`KalshiMadness`);
  lines.push(`Markets: ${report.markets.length} | Events: ${report.byEvent.size} | Alerts: ${report.alerts.length}`);
  lines.push("");
  const cap = 25;
  for (let i = 0; i < Math.min(report.alerts.length, cap); i++) {
    const alert = report.alerts[i];
    lines.push(`[${alert.type}] ${alert.detail}`);
    lines.push(`  A: ${alert.a.market.ticker} p≈${alert.a.pYes?.toFixed(3) ?? "?"}`);
    lines.push(`  B: ${alert.b.market.ticker} p≈${alert.b.pYes?.toFixed(3) ?? "?"}`);
    lines.push("");
  }
  if (report.alerts.length > cap) {
    lines.push(`… +${report.alerts.length - cap} more alerts`);
  }
  if (report.alerts.length === 0) {
    lines.push("No alerts over current thresholds.");
  }
  return lines.join("\n");
}

export function formatReport(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`Markets loaded: ${report.markets.length}`);
  lines.push(`Unique events: ${report.byEvent.size}`);
  lines.push("");

  if (report.alerts.length === 0) {
    lines.push("No heuristic discrepancies matched current thresholds.");
  } else {
    lines.push(`Alerts (${report.alerts.length}):`);
    for (const alert of report.alerts) {
      const ma = alert.a.market;
      const mb = alert.b.market;
      lines.push(`--- [${alert.type}] ${alert.detail}`);
      lines.push(`  A: ${ma.ticker} | ${ma.yes_sub_title || ma.title} | p≈${alert.a.pYes?.toFixed(3) ?? "?"}`);
      lines.push(`  B: ${mb.ticker} | ${mb.yes_sub_title || mb.title} | p≈${alert.b.pYes?.toFixed(3) ?? "?"}`);
    }
  }

  lines.push("");
  lines.push("=== Tournament prop buckets (cross-check vs game lines) ===");
  const bucketOrder: PropBucket[] = [
    "game_moneyline",
    "team_advance",
    "seed_max_in_round",
    "seed_count_in_round",
    "upset_count",
    "aggregate_misc",
    "other",
  ];
  for (const bucket of bucketOrder) {
    const group = report.byPropBucket.get(bucket);
    if (!group?.length) continue;
    lines.push(`-- ${bucket} (${group.length}) --`);
    const byRound = groupBy(group, (x) => x.bracketRound);
    const rounds: BracketRound[] = ["e8", "f4", "s16", "r32", "r64", "unknown"];
    let printed = false;
    for (const r of rounds) {
      const rg = byRound.get(r);
      if (!rg?.length) continue;
      printed = true;
      lines.push(`  [${r}]`);
      for (const x of rg) lines.push(formatAnnotatedLine(x));
    }
    if (!printed) {
      for (const x of group) lines.push(formatAnnotatedLine(x));
    }
    const sample = group[0];
    if (sample) {
      const notes = correlationNotes(bucket, sample.bracketRound);
      for (const n of notes) lines.push(`  → ${n}`);
    }
  }

  lines.push("");
  lines.push("=== Correlation playbook (manual / model) ===");
  for (const row of CORRELATION_PLAYBOOK) lines.push(`  • ${row}`);

  lines.push("");
  lines.push("Per-event snapshot (open markets, 2+ contracts):");
  for (const [evt, group] of report.byEvent) {
    if (group.length < 2) continue;
    lines.push(`Event ${evt}:`);
    for (const x of group) {
      lines.push(formatAnnotatedLine(x));
    }
  }

  return lines.join("\n");
}
