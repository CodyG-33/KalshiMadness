/**
 * Kalshi credential checks — same idea as infraform validate-env (skipped in MOCK_MODE).
 */

function getEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

export function validateKalshiEnvOrExit(): void {
  if (getEnv("MOCK_MODE") === "true" || getEnv("MOCK_MODE") === "1") {
    return;
  }

  const missing: string[] = [];
  if (!getEnv("KALSHI_API_KEY")) missing.push("KALSHI_API_KEY");

  const keyPath = getEnv("KALSHI_PRIVATE_KEY_PATH");
  const keyPem = getEnv("KALSHI_PRIVATE_KEY_PEM");
  if (!keyPath && !keyPem) {
    missing.push("KALSHI_PRIVATE_KEY_PEM (recommended) or KALSHI_PRIVATE_KEY_PATH");
  }

  if (missing.length === 0) return;

  const message =
    "Missing environment variable(s):\n  - " +
    missing.join("\n  - ") +
    "\n\nSet them in .env in the project root.";
  console.error("\n[Config] " + message + "\n");
  process.exit(1);
}
