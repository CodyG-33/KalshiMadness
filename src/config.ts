import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const BASE_PATHS = {
  prod: "https://api.elections.kalshi.com/trade-api/v2",
  demo: "https://demo-api.kalshi.co/trade-api/v2",
} as const;

const PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
const PEM_FOOTER = "-----END RSA PRIVATE KEY-----";

/** Normalize PEM for Node (literal \\n, line length) — from infraform/polymarket-kalshi-arbitrage-bot */
function normalizePrivateKeyPem(value: string): string {
  let trimmed = value.trim().replace(/\\n/g, "\n").trim();
  let base64 = trimmed
    .replace(/-----BEGIN RSA PRIVATE KEY-----/g, "")
    .replace(/-----END RSA PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) return trimmed;
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += 64) {
    lines.push(base64.slice(i, i + 64));
  }
  return `${PEM_HEADER}\n${lines.join("\n")}\n${PEM_FOOTER}`;
}

function getPrivateKeyPem(): string {
  const raw = (process.env.KALSHI_PRIVATE_KEY_PEM ?? "").trim();
  if (!raw) return "";
  return normalizePrivateKeyPem(raw);
}

function parseSeriesList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTradeAlertTypes(raw: string | undefined): Set<string> {
  const s = (raw ?? "equiv_gap,ordering_violation,advance_monotonicity")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return new Set(s);
}

function normalizeTradeMode(v: string): "off" | "dry_run" | "live" {
  const x = v.trim().toLowerCase().replace(/-/g, "_");
  if (x === "live") return "live";
  if (x === "dry_run") return "dry_run";
  return "off";
}

function normalizeTradeExecution(v: string): "taker" | "maker" {
  return v.trim().toLowerCase() === "maker" ? "maker" : "taker";
}

export const config = {
  apiKey: process.env.KALSHI_API_KEY ?? "",
  get privateKeyPem(): string {
    return getPrivateKeyPem();
  },
  privateKeyPath: process.env.KALSHI_PRIVATE_KEY_PATH ?? "",
  demo: process.env.KALSHI_DEMO === "true",
  basePath:
    process.env.KALSHI_BASE_PATH ??
    (process.env.KALSHI_DEMO === "true" ? BASE_PATHS.demo : BASE_PATHS.prod),
  mockMode: process.env.MOCK_MODE === "true" || process.env.MOCK_MODE === "1",
  scanSeries: parseSeriesList(
    process.env.KALSHI_SCAN_SERIES ??
      "KXNCAAMBGAME"
  ),
  minEquivProbGap: parseFloat(process.env.MIN_EQUIV_PROB_GAP ?? "0.04"),
  maxAdvanceOverWin: parseFloat(process.env.MAX_ADVANCE_OVER_WIN ?? "0.02"),
  scanLoopIntervalSec: parseInt(process.env.SCAN_LOOP_INTERVAL_SEC ?? "120", 10),

  /** Telegram: set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID and TELEGRAM_ENABLED=true */
  telegramEnabled: process.env.TELEGRAM_ENABLED === "true" || process.env.TELEGRAM_ENABLED === "1",
  telegramBotToken: (process.env.TELEGRAM_BOT_TOKEN ?? "").trim(),
  telegramChatId: (process.env.TELEGRAM_CHAT_ID ?? "").trim(),

  /**
   * off — alerts only (default)
   * dry_run — log planned orders, no Kalshi POST
   * live — place limit orders (you accept full risk)
   */
  tradeMode: normalizeTradeMode(process.env.TRADE_MODE ?? "off"),
  /** Comma list: equiv_gap, ordering_violation, advance_monotonicity */
  tradeAlertTypes: parseTradeAlertTypes(process.env.TRADE_ALERT_TYPES),
  /** taker — limit at best ask (+ buffer) to lift liquidity; maker — post-only inside spread (may not fill) */
  tradeExecution: normalizeTradeExecution(process.env.TRADE_EXECUTION ?? "taker"),
  tradeMaxContracts: Math.max(1, parseInt(process.env.TRADE_MAX_CONTRACTS ?? "1", 10)),
  /** Max total cents willing to pay per order (contracts × limit price capped by this) */
  tradeMaxSpendCents: Math.max(1, parseInt(process.env.TRADE_MAX_SPEND_CENTS ?? "500", 10)),
  /** Optional: cap contracts using balance × this percent / price (0 = disable) */
  tradeAllocationPct: parseFloat(process.env.TRADE_ALLOCATION_PCT ?? "0"),
  tradePriceBufferCents: Math.max(0, parseInt(process.env.TRADE_PRICE_BUFFER_CENTS ?? "1", 10)),
  tradeMaxOrdersPerScan: Math.max(0, parseInt(process.env.TRADE_MAX_ORDERS_PER_SCAN ?? "3", 10)),
};
