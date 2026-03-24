import type { Market } from "kalshi-typescript";
import { config } from "./config";
import { classifyMarketKind, teamFingerprint, type MarketKind } from "./classify-market";
import { fetchAllScanMarkets } from "./fetch-markets";
import { impliedYesProb } from "./market-math";
import {
  isEliteEightAdvanceContract,
  isTradableEliteEightVsGamePair,
  teamCodeFromTicker,
} from "./tradable-pairs";
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

/** Tradable leg: Elite Eight advance vs same-team NCAA game moneyline. */
export type CorrelatedLinkType = "e8_advance_vs_game";

export interface CorrelatedPair {
  linkType: CorrelatedLinkType;
  /** Always the E8 advance contract */
  advance: AnnotatedMarket;
  /** Same-team KXNCAAMBGAME (or *GAME* series) moneyline */
  game: AnnotatedMarket;
}

export interface CorrelatedPairsBundle {
  /** Rows to print (sorted by |Δp| when truncated) */
  pairs: CorrelatedPair[];
  total: number;
  truncated: boolean;
}

const MAX_CORRELATED_PAIR_ROWS = 200;

function gapAbs(pa: number | null, pb: number | null): number {
  if (pa == null || pb == null) return -1;
  return Math.abs(pa - pb);
}

function leg(x: AnnotatedMarket) {
  return {
    ticker: x.market.ticker,
    kind: x.kind,
    bracketRound: x.bracketRound,
  };
}

/**
 * Only **tradable** pairs: Elite Eight advance (ticker …26E8… or e8 copy) vs same team code
 * on a scanned *GAME* series moneyline. Sorted by smallest |Δp| first (tightest = most interesting).
 */
export function buildCorrelatedPairsBundle(annotated: AnnotatedMarket[]): CorrelatedPairsBundle {
  const series = config.scanSeries;
  const raw: CorrelatedPair[] = [];
  for (let i = 0; i < annotated.length; i++) {
    for (let j = i + 1; j < annotated.length; j++) {
      const x = annotated[i];
      const y = annotated[j];
      if (!isTradableEliteEightVsGamePair(leg(x), leg(y), series)) continue;
      const adv = isEliteEightAdvanceContract(x.market.ticker, x.kind, x.bracketRound) ? x : y;
      const game = adv === x ? y : x;
      raw.push({ linkType: "e8_advance_vs_game", advance: adv, game });
    }
  }
  const scored = raw.map((pair) => ({
    pair,
    g: gapAbs(pair.advance.pYes, pair.game.pYes),
  }));
  scored.sort((u, v) => {
    const au = u.g >= 0 ? u.g : 999;
    const av = v.g >= 0 ? v.g : 999;
    return au - av;
  });
  const truncated = scored.length > MAX_CORRELATED_PAIR_ROWS;
  const pairs = scored.slice(0, MAX_CORRELATED_PAIR_ROWS).map((s) => s.pair);
  return { pairs, total: raw.length, truncated };
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
 * Tradable-pair alerts only: Elite Eight advance vs same-team game moneyline, |Δp| ≤ maxTradableCompareGap.
 */
export function findDiscrepancies(annotated: AnnotatedMarket[]): DiscrepancyAlert[] {
  const alerts: DiscrepancyAlert[] = [];
  const series = config.scanSeries;
  const maxGap = config.maxTradableCompareGap;

  for (let i = 0; i < annotated.length; i++) {
    for (let j = i + 1; j < annotated.length; j++) {
      const x = annotated[i];
      const y = annotated[j];
      if (!isTradableEliteEightVsGamePair(leg(x), leg(y), series)) continue;

      const adv = isEliteEightAdvanceContract(x.market.ticker, x.kind, x.bracketRound) ? x : y;
      const game = adv === x ? y : x;
      const pa = adv.pYes;
      const pb = game.pYes;
      if (pa == null || pb == null) continue;

      const gap = Math.abs(pa - pb);
      if (gap > maxGap) continue;

      if (pa > pb + config.maxAdvanceOverWin) {
        alerts.push({
          type: "ordering_violation",
          detail: `P(E8 advance)=${pa.toFixed(3)} > P(game)=${pb.toFixed(3)} by > ${config.maxAdvanceOverWin} (tradable pair)`,
          a: adv,
          b: game,
        });
      }

      if (gap >= config.minEquivProbGap) {
        const code = teamCodeFromTicker(adv.market.ticker) ?? "?";
        alerts.push({
          type: "equiv_gap",
          detail: `Tradable ${code}: |P(E8 advance) - P(game)| = ${gap.toFixed(3)} ≥ ${config.minEquivProbGap} (cap ${maxGap})`,
          a: adv,
          b: game,
        });
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
  /** Tradable E8 advance vs same-team game line (all such pairs, smallest |Δp| first). */
  correlated: CorrelatedPairsBundle;
}

export async function runScan(): Promise<ScanReport> {
  const markets = await fetchAllScanMarkets();
  const annotated = markets.map(annotate);
  const byEvent = groupBy(annotated, (x) => x.market.event_ticker);
  const byPropBucket = groupBy(annotated, (x) => x.propBucket);
  const alerts = findDiscrepancies(annotated);
  const correlated = buildCorrelatedPairsBundle(annotated);
  return { markets: annotated, byEvent, byPropBucket, alerts, correlated };
}

function formatCorrelatedBlock(pair: CorrelatedPair): string[] {
  const adv = pair.advance;
  const game = pair.game;
  const pa = adv.pYes;
  const pb = game.pYes;
  const delta =
    pa != null && pb != null ? `|Δp|=${Math.abs(pa - pb).toFixed(3)}` : "|Δp|=n/a";
  const code = teamCodeFromTicker(adv.market.ticker) ?? adv.teamKey ?? "?";
  const lines: string[] = [];
  lines.push(`  [E8 advance vs game moneyline] team=${code} ${delta}`);
  lines.push(
    `    Advance: ${adv.market.ticker} | round=${adv.bracketRound} | p≈${pa?.toFixed(3) ?? "?"} | ${adv.market.yes_sub_title || adv.market.title}`
  );
  lines.push(
    `    Game:    ${game.market.ticker} | p≈${pb?.toFixed(3) ?? "?"} | ${game.market.yes_sub_title || game.market.title}`
  );
  return lines;
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
  lines.push(
    `Markets: ${report.markets.length} | Events: ${report.byEvent.size} | Alerts: ${report.alerts.length} | Correlated pairs: ${report.correlated.total}`
  );
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
  const prev = report.correlated.pairs.slice(0, 5);
  if (prev.length > 0) {
    lines.push("Tightest tradable pairs (smallest |Δp|):");
    for (const pair of prev) {
      const pa = pair.advance.pYes;
      const pb = pair.game.pYes;
      const d =
        pa != null && pb != null ? Math.abs(pa - pb).toFixed(3) : "?";
      lines.push(`  |Δ|=${d}`);
      lines.push(`    ${pair.advance.market.ticker} vs ${pair.game.market.ticker}`);
    }
  }
  return lines.join("\n");
}

export function formatReport(report: ScanReport): string {
  const lines: string[] = [];
  lines.push(`Markets loaded: ${report.markets.length}`);
  lines.push(`Unique events: ${report.byEvent.size}`);
  lines.push("");

  if (report.alerts.length === 0) {
    lines.push("No tradable-pair discrepancies matched current thresholds (E8 advance vs game, |Δp| ≤ cap).");
  } else {
    lines.push(`Alerts — tradable pairs only (${report.alerts.length}):`);
    for (const alert of report.alerts) {
      const ma = alert.a.market;
      const mb = alert.b.market;
      lines.push(`--- [${alert.type}] ${alert.detail}`);
      lines.push(`  A: ${ma.ticker} | ${ma.yes_sub_title || ma.title} | p≈${alert.a.pYes?.toFixed(3) ?? "?"}`);
      lines.push(`  B: ${mb.ticker} | ${mb.yes_sub_title || mb.title} | p≈${alert.b.pYes?.toFixed(3) ?? "?"}`);
    }
  }

  lines.push("");
  const { pairs, total, truncated } = report.correlated;
  if (total === 0) {
    lines.push("=== Tradable pairs (E8 advance vs game moneyline) ===");
    lines.push(
      "  None found. Use KALSHI_SCAN_SERIES with a *GAME* series (e.g. KXNCAAMBGAME) plus MARMADROUND E8 lines (tickers containing 26E8)."
    );
  } else {
    const capNote = truncated
      ? ` (showing ${pairs.length} of ${total}, smallest |Δp| first)`
      : " (smallest |Δp| first)";
    lines.push(`=== Tradable pairs (E8 advance vs game moneyline)${capNote} ===`);
    for (const pair of pairs) {
      lines.push(...formatCorrelatedBlock(pair));
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
