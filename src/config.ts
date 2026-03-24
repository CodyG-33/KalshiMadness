import crypto from "crypto";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

/** `.env` wins over pre-set shell vars (fixes TELEGRAM_ENABLED=false stuck in environment). */
dotenv.config({ path: path.join(__dirname, "..", ".env"), override: true });

const PROJECT_ROOT = path.join(__dirname, "..");
/** Inline env PEM shorter than this is treated as a placeholder (real RSA PEMs are much longer). */
const MIN_INLINE_PEM_CHARS = 280;

const BASE_PATHS = {
  prod: "https://api.elections.kalshi.com/trade-api/v2",
  demo: "https://demo-api.kalshi.co/trade-api/v2",
} as const;

const PEM_HEADER = "-----BEGIN RSA PRIVATE KEY-----";
const PEM_FOOTER = "-----END RSA PRIVATE KEY-----";

/** Normalize PEM for Node (literal \\n, line length) — from infraform/polymarket-kalshi-arbitrage-bot */
export function normalizeKalshiPrivateKeyPem(value: string): string {
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

/**
 * Pick a PEM string Node/OpenSSL accepts. PKCS#8 (`BEGIN PRIVATE KEY`) must not be
 * passed through normalizeKalshiPrivateKeyPem — that helper is PKCS#1 RSA only.
 */
export function resolveKalshiPrivateKeyPem(rawInput: string, source: string): string {
  const raw = rawInput
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!raw) return "";

  const looksPkcs8 = /^-----BEGIN (ENCRYPTED )?PRIVATE KEY-----/m.test(raw);

  const candidates: string[] = [];
  if (looksPkcs8) {
    candidates.push(raw);
  } else {
    candidates.push(raw);
    const normalized = normalizeKalshiPrivateKeyPem(raw);
    if (normalized !== raw) candidates.push(normalized);
  }

  let lastErr: Error | undefined;
  for (const pem of candidates) {
    try {
      const key = crypto.createPrivateKey(pem);
      if (key.asymmetricKeyType !== "rsa") {
        lastErr = new Error(`Expected RSA private key, got ${key.asymmetricKeyType ?? "unknown"}`);
        continue;
      }
      return pem;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }

  const firstLine = raw.split("\n")[0]?.slice(0, 72) ?? "(empty)";
  throw new Error(
    `Kalshi private key from ${source} failed to parse (${lastErr?.message ?? "unknown"}). ` +
      `Length ${raw.length} chars; first line: ${firstLine}. ` +
      `If you use KALSHI_PRIVATE_KEY_PATH, remove or comment out KALSHI_PRIVATE_KEY_PEM in .env. ` +
      `Try: openssl rsa -in your.pem -check -noout`
  );
}

/**
 * Resolve private key: configured file path, then ./kalshi_private_key.pem, then a long
 * KALSHI_PRIVATE_KEY_PEM. Short env values (shell placeholders, partial .env) are skipped
 * so they do not override a real on-disk key.
 */
export function findKalshiPrivateKeyPem(): string {
  const pathsToTry: string[] = [];
  const configured = (process.env.KALSHI_PRIVATE_KEY_PATH ?? "").trim();
  if (configured) {
    const abs = path.isAbsolute(configured)
      ? configured
      : path.resolve(PROJECT_ROOT, configured.replace(/^\.\//, ""));
    pathsToTry.push(abs);
  }
  pathsToTry.push(path.join(PROJECT_ROOT, "kalshi_private_key.pem"));

  const seen = new Set<string>();
  for (const abs of pathsToTry) {
    const norm = path.normalize(abs);
    if (seen.has(norm)) continue;
    seen.add(norm);
    try {
      if (!fs.existsSync(abs)) continue;
      if (fs.statSync(abs).size < 80) continue;
      const raw = fs.readFileSync(abs, "utf8");
      return resolveKalshiPrivateKeyPem(raw, abs);
    } catch {
      continue;
    }
  }

  const envRaw = (process.env.KALSHI_PRIVATE_KEY_PEM ?? "").trim();
  if (!envRaw) {
    throw new Error(
      "No usable Kalshi private key. Set KALSHI_PRIVATE_KEY_PATH, add kalshi_private_key.pem " +
        "in the project root, or set KALSHI_PRIVATE_KEY_PEM to the full PEM."
    );
  }
  if (envRaw.length < MIN_INLINE_PEM_CHARS) {
    throw new Error(
      `KALSHI_PRIVATE_KEY_PEM is only ${envRaw.length} characters (too short for a real RSA key). ` +
        "Unset it in your shell and .env, or use KALSHI_PRIVATE_KEY_PATH=./kalshi_private_key.pem."
    );
  }
  return resolveKalshiPrivateKeyPem(envRaw, "KALSHI_PRIVATE_KEY_PEM");
}

function getPrivateKeyPem(): string {
  const raw = (process.env.KALSHI_PRIVATE_KEY_PEM ?? "").trim();
  if (!raw) return "";
  return normalizeKalshiPrivateKeyPem(raw);
}

function parseSeriesList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTradeAlertTypes(raw: string | undefined): Set<string> {
  const s = (raw ?? "equiv_gap,ordering_violation")
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

/** Accepts true / 1 / yes / on (any case). */
function parseEnvBool(raw: string | undefined): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

function stripOuterQuotes(s: string): string {
  const t = s.trim();
  if (t.length >= 2) {
    if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1).trim();
    if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1).trim();
  }
  return t;
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
  /** Min |Δ implied YES| to flag E8 advance vs same-team game line (tradable pair only). */
  minEquivProbGap: parseFloat(process.env.MIN_EQUIV_PROB_GAP ?? "0.015"),
  maxAdvanceOverWin: parseFloat(process.env.MAX_ADVANCE_OVER_WIN ?? "0.02"),
  /**
   * Tradable E8-vs-game alerts are skipped if |Δp| exceeds this (usually means wrong pairing, not arb).
   */
  maxTradableCompareGap: parseFloat(process.env.MAX_TRADABLE_COMPARE_GAP ?? "0.10"),
  scanLoopIntervalSec: parseInt(process.env.SCAN_LOOP_INTERVAL_SEC ?? "120", 10),
  /** Full market buckets, playbook, per-event listing (default: tradable alerts + pairs only). */
  scanVerboseReport:
    process.env.SCAN_VERBOSE_REPORT === "true" || process.env.SCAN_VERBOSE_REPORT === "1",

  /** Telegram: set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID and TELEGRAM_ENABLED=true (or yes/on/1) */
  telegramEnabled: parseEnvBool(process.env.TELEGRAM_ENABLED),
  telegramBotToken: stripOuterQuotes((process.env.TELEGRAM_BOT_TOKEN ?? "").trim()),
  telegramChatId: stripOuterQuotes((process.env.TELEGRAM_CHAT_ID ?? "").trim()),

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
