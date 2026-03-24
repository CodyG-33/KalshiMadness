import type { Market } from "kalshi-typescript";
import type { MarketKind } from "./classify-market";

/** Bracket depth mentioned in copy (best-effort). */
export type BracketRound = "r64" | "r32" | "s16" | "e8" | "f4" | "unknown";

/** What kind of tournament contract this is for grouping with game lines. */
export type PropBucket =
  | "game_moneyline"
  | "team_advance"
  | "seed_max_in_round"
  | "seed_count_in_round"
  | "upset_count"
  | "aggregate_misc"
  | "other";

const ROUND_PATTERNS: { re: RegExp; round: BracketRound }[] = [
  { re: /\b(final\s*four|f4)\b/i, round: "f4" },
  { re: /\b(elite\s*eight|elite\s*8|round\s*of\s*8|e8)\b/i, round: "e8" },
  { re: /\b(sweet\s*16|sweet\s*sixteen|round\s*of\s*16|s16)\b/i, round: "s16" },
  { re: /\b(round\s*of\s*32|second\s*round|r32)\b/i, round: "r32" },
  { re: /\b(first\s*round|round\s*of\s*64|r64)\b/i, round: "r64" },
];

/** Pull round from title / subtitles. */
export function extractBracketRound(m: Market): BracketRound {
  const text = `${m.title ?? ""} ${m.subtitle ?? ""} ${m.yes_sub_title ?? ""}`;
  for (const { re, round } of ROUND_PATTERNS) {
    if (re.test(text)) return round;
  }
  return "unknown";
}

const SEED_NUM_RE = /\b(?:#|no\.?\s*)?(\d{1,2})\s*seed\b|\bseed\s*(?:#|no\.?\s*)?(\d{1,2})\b/gi;

export function extractSeedHints(m: Market): number[] {
  const text = `${m.title ?? ""} ${m.subtitle ?? ""} ${m.yes_sub_title ?? ""}`;
  const out: number[] = [];
  let mch: RegExpExecArray | null;
  const re = new RegExp(SEED_NUM_RE.source, "gi");
  while ((mch = re.exec(text)) !== null) {
    const n = parseInt(mch[1] ?? mch[2] ?? "", 10);
    if (n >= 1 && n <= 16) out.push(n);
  }
  return [...new Set(out)];
}

/** Count-like numbers in prop (upsets, "exactly 3", etc.) — weak heuristic. */
export function extractCountHints(m: Market): number[] {
  const text = `${m.title ?? ""} ${m.subtitle ?? ""}`;
  const out: number[] = [];
  const re = /\b(exactly|at\s*least|at\s*most|fewer\s*than|more\s*than)\s+(\d{1,2})\b/gi;
  let mch: RegExpExecArray | null;
  while ((mch = re.exec(text)) !== null) {
    const n = parseInt(mch[2], 10);
    if (n >= 0 && n <= 64) out.push(n);
  }
  return [...new Set(out)];
}

/**
 * Classify prop bucket. `kind` comes from existing win/advance classifier.
 */
export function classifyPropBucket(m: Market, kind: MarketKind): PropBucket {
  const text = `${m.title ?? ""} ${m.subtitle ?? ""} ${m.yes_sub_title ?? ""}`;
  const t = text.toLowerCase();

  if (kind === "single_game_win") return "game_moneyline";
  if (kind === "advance") return "team_advance";

  const upset =
    /\bupset\b/i.test(text) ||
    /\bupsets\b/i.test(text) ||
    /\blower\s*seed\b/i.test(text) ||
    /\bhigher\s*seed\s*(wins|win)\b/i.test(text);

  const seedLine =
    /\bhighest\b/i.test(text) &&
    /\bseed\b/i.test(text) &&
    (/\b(numerical|numeric|number)\b/i.test(text) || /\blowest\b/i.test(text));

  const numSeedsReach =
    (/\bhow\s+many\b/i.test(text) || /\bnumber\s+of\b/i.test(text) || /\b#\s*1\b/.test(text) || /\bone\s+seed/i.test(text)) &&
    /\bseed/i.test(text) &&
    /\b(reach|get\s+to|make|qualif|advance)/i.test(text);

  if (upset && (t.includes("16") || t.includes("sixteen") || t.includes("sweet") || t.includes("second round")))
    return "upset_count";

  if (seedLine && (t.includes("8") || t.includes("eight") || t.includes("elite"))) return "seed_max_in_round";

  if (numSeedsReach && (t.includes("8") || t.includes("eight") || t.includes("elite"))) return "seed_count_in_round";

  if (/\bhow\s+many\b/i.test(text) && /\bupset/i.test(text)) return "upset_count";

  if (/\bseed\b/i.test(text) && /\b(reach|qualif|advance|make\s+the)/i.test(text) && kind === "unknown")
    return "seed_count_in_round";

  if (
    kind === "unknown" &&
    (/\bprop\b/i.test(text) || /\btotal\b/i.test(text) || /\bover\/under\b/i.test(text) || /\bou\b/i.test(text))
  )
    return "aggregate_misc";

  return "other";
}

/**
 * Human-readable notes on how this prop ties to game-level markets (for report footer).
 */
export function correlationNotes(bucket: PropBucket, round: BracketRound): string[] {
  const rLabel =
    round === "unknown"
      ? "that round"
      : round === "e8"
        ? "the Elite Eight / Round of 8"
        : round === "s16"
          ? "the Sweet 16 / Round of 16"
          : round === "f4"
            ? "the Final Four"
            : round.toUpperCase();
  switch (bucket) {
    case "team_advance":
      return [
        `Compare to the same team's moneyline(s) on the path to ${rLabel}; P(advance to a later round) ≤ P(advance to an earlier round) and ≤ each relevant single-game win prob (modulo wording).`,
      ];
    case "seed_max_in_round":
      return [
        `Highest numeric seed to reach ${rLabel} is driven by upset paths; cross-check vs implied upset rates in earlier rounds and individual game lines for high seeds.`,
      ];
    case "upset_count":
      return [
        `Upset counts in a round are sums of correlated Bernoullis; game-level YES prices imply a distribution — full consistency needs simulation or explicit joint model.`,
      ];
    case "seed_count_in_round":
      return [
        `#1 (or top) seeds reaching ${rLabel} are bounded by per-game survival probabilities; sum of individual P(reach) is a first-order cross-check vs this market.`,
      ];
    case "game_moneyline":
      return [`Building block for bracket props; pair with same-team "advance to …" when wording matches.`];
    default:
      return [];
  }
}

export const CORRELATION_PLAYBOOK: string[] = [
  "Game moneylines + 'Team X advances to Elite Eight / Round of 8' should be internally consistent along a single-elimination path.",
  "Markets like 'highest seed in the Round of 8' embed many game outcomes; use game lines to sanity-check tail scenarios (many low seeds winning).",
  "'Number of upsets in the Round of 16' depends on which games count as upsets (seed definition, First Four, etc.) — read settlement rules before tying to prices.",
  "'#1 seeds to reach Round of 8' ↔ multiply conditional win probabilities for each 1-seed's path (approximate independence) vs this market's implied distribution.",
];
