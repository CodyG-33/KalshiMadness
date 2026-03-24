import type { Market } from "kalshi-typescript";

export type MarketKind = "advance" | "single_game_win" | "unknown";

const ADVANCE_RE =
  /\b(advance|advances|next round|move on|sweet\s*16|elite\s*eight|elite\s*8|final\s*four|round\s+of\s+\d+|reach(es)?\s+the|make(s)?\s+the|qualif(y|ies)|get\s+to\s+the)\b/i;

const WIN_RE =
  /\b(win|wins|beat|defeat|moneyline|to\s+beat|winner|defeats)\b/i;

/**
 * Tournament *aggregate* props often say "reach the Elite Eight" but are not team advance lines.
 * Keep them as `unknown` so `classifyPropBucket` can tag seed/upset/count markets.
 */
function isAggregateBracketProp(text: string): boolean {
  const t = text.toLowerCase();
  if (/\bhighest\b/.test(t) && /\bseed\b/.test(t)) return true;
  if (/\bhow\s+many\b/.test(t) && /\bseed/.test(t)) return true;
  if (/\bnumber\s+of\b/.test(t) && /\b(#\s*1|1\s*seed|\bone\s+seed)/i.test(text)) return true;
  if (/\bupsets?\b/.test(t) && (/\bexactly\b/.test(t) || /\bat\s+least\b/.test(t) || /\bhow\s+many\b/.test(t)))
    return true;
  return false;
}

export function classifyMarketKind(m: Market): MarketKind {
  const text = `${m.title ?? ""} ${m.subtitle ?? ""} ${m.yes_sub_title ?? ""}`;
  if (isAggregateBracketProp(text)) return "unknown";

  const advance = ADVANCE_RE.test(text);
  const win = WIN_RE.test(text);
  if (advance && !win) return "advance";
  if (win && !advance) return "single_game_win";
  if (advance && win) return "advance";
  return "unknown";
}

/**
 * Rough team / proposition fingerprint for grouping correlated contracts.
 * Not perfect — tune for live Kalshi copy.
 */
export function teamFingerprint(m: Market): string {
  const raw = (m.yes_sub_title || m.title || "").toLowerCase().trim();
  const cleaned = raw.replace(/^yes\s+/i, "");
  const stops = [
    " wins",
    " win ",
    " advance",
    " advances",
    " beat",
    " defeat",
    " to win",
    " to beat",
    " moneyline",
    " reaches",
    " reach ",
  ];
  let key = cleaned;
  for (const s of stops) {
    const i = cleaned.indexOf(s);
    if (i > 0) {
      key = cleaned.slice(0, i);
      break;
    }
  }
  return key.trim().replace(/\s+/g, " ").slice(0, 80);
}
