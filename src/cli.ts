import { config } from "./config";
import { validateKalshiEnvOrExit } from "./validate-env";
import { fetchBalanceUsd } from "./kalshi";
import { runScanWithNotifications } from "./runner";

async function cmdBalance(): Promise<void> {
  validateKalshiEnvOrExit();
  const { balanceUsd, portfolioUsd } = await fetchBalanceUsd();
  console.log(`Available balance: $${balanceUsd.toFixed(2)}`);
  console.log(`Portfolio value:   $${portfolioUsd.toFixed(2)}`);
}

async function cmdScan(loop: boolean): Promise<void> {
  validateKalshiEnvOrExit();

  const once = async () => {
    console.log(
      `[KalshiMadness] series=${config.scanSeries.join(",")} mock=${config.mockMode} minGap=${config.minEquivProbGap} trade=${config.tradeMode} telegram=${config.telegramEnabled}`
    );
    await runScanWithNotifications();
  };

  await once();
  if (!loop) return;

  const sec = Math.max(30, config.scanLoopIntervalSec);
  console.log(`\nLoop every ${sec}s (Ctrl+C to stop)\n`);
  for (;;) {
    await new Promise((r) => setTimeout(r, sec * 1000));
    await once();
  }
}

async function main(): Promise<void> {
  const [, , cmd, ...rest] = process.argv;
  if (cmd === "balance") {
    await cmdBalance();
    return;
  }
  if (cmd === "scan") {
    const loop = rest.includes("--loop");
    await cmdScan(loop);
    return;
  }

  console.log(`Usage:
  npm run scan              Scan + Telegram (if enabled) + trade (TRADE_MODE)
  npm run scan:watch        Repeat scan every SCAN_LOOP_INTERVAL_SEC
  npm run balance           Kalshi portfolio balance (cents → USD)

Env: project root .env — TELEGRAM_*, TRADE_MODE=off|dry_run|live, TRADE_EXECUTION=taker|maker
`);
  process.exit(cmd ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
