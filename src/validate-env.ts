/**
 * Kalshi credential checks — same idea as infraform validate-env (skipped in MOCK_MODE).
 */

import { findKalshiPrivateKeyPem } from "./config";

function getEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function validateKalshiEnvOrExit(): void {
  if (getEnv("MOCK_MODE") === "true" || getEnv("MOCK_MODE") === "1") {
    return;
  }

  const missing: string[] = [];
  if (!getEnv("KALSHI_API_KEY")) missing.push("KALSHI_API_KEY");

  if (missing.length > 0) {
    const message =
      "Missing environment variable(s):\n  - " +
      missing.join("\n  - ") +
      "\n\nSet them in .env in the project root.";
    console.error("\n[Config] " + message + "\n");
    process.exit(1);
  }

  try {
    findKalshiPrivateKeyPem();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`\n[Config] ${msg}\n`);
    process.exit(1);
  }
}
