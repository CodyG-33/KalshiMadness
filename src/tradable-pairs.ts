import type { MarketKind } from "./classify-market";
import type { BracketRound } from "./tournament-props";

/**
 * Kalshi NCAA game tickers end with a team code (e.g. KXNCAAMBGAME-...-DUKE).
 */
export function teamCodeFromTicker(ticker: string): string | null {
  const parts = ticker.split("-");
  const last = parts[parts.length - 1]?.trim();
  if (!last || last.length < 2 || last.length > 8) return null;
  if (!/^[A-Za-z0-9]+$/i.test(last)) return null;
  return last.toUpperCase();
}

/** e.g. KXNCAAMBGAME — any scanned series whose ticker suggests per-game contracts. */
export function gameMoneylineSeriesPrefixes(scanSeries: string[]): string[] {
  const fromEnv = scanSeries.filter((s) => /GAME/i.test(s));
  return fromEnv.length > 0 ? fromEnv : ["KXNCAAMBGAME"];
}

export function isScannedGameMoneyline(
  ticker: string,
  kind: MarketKind,
  scanSeries: string[]
): boolean {
  if (kind !== "single_game_win") return false;
  return gameMoneylineSeriesPrefixes(scanSeries).some((p) => ticker.startsWith(`${p}-`));
}

/**
 * Elite Eight advance: Kalshi uses ...-26E8-TEAM in MARMADROUND; mock uses ADV-E8; copy can set bracketRound e8.
 */
export function isEliteEightAdvanceContract(
  ticker: string,
  kind: MarketKind,
  bracketRound: BracketRound
): boolean {
  if (kind !== "advance") return false;
  if (bracketRound === "e8") return true;
  if (/-26E8-/i.test(ticker)) return true;
  if (/ADV-?E8/i.test(ticker)) return true;
  return false;
}

export interface TradableLeg {
  ticker: string;
  kind: MarketKind;
  bracketRound: BracketRound;
}

export function isTradableEliteEightVsGamePair(
  a: TradableLeg,
  b: TradableLeg,
  scanSeries: string[]
): boolean {
  const ta = a.ticker;
  const tb = b.ticker;
  const ca = teamCodeFromTicker(ta);
  const cb = teamCodeFromTicker(tb);
  if (!ca || !cb || ca !== cb) return false;

  const aE8 = isEliteEightAdvanceContract(ta, a.kind, a.bracketRound);
  const bE8 = isEliteEightAdvanceContract(tb, b.kind, b.bracketRound);
  const aGame = isScannedGameMoneyline(ta, a.kind, scanSeries);
  const bGame = isScannedGameMoneyline(tb, b.kind, scanSeries);

  return (aE8 && bGame) || (bE8 && aGame);
}
