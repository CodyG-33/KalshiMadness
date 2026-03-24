import { config } from "./config";
import { fetchBalanceCents } from "./kalshi";
import {
  formatReport,
  formatScanSummaryForTelegram,
  runScan,
  type ScanReport,
} from "./scanner";
import { sendTelegramMessages } from "./telegram";
import { getYesNoQuoteCents, limitPriceForBuy, placeKalshiLimitOrder } from "./trade";
import { planOrdersFromAlerts } from "./trade-plan";

function computeContractCount(priceCents: number, balanceCents: number): number {
  const maxC = config.tradeMaxContracts;
  const spendCap = Math.floor(config.tradeMaxSpendCents / Math.max(1, priceCents));
  let n = Math.min(maxC, spendCap);
  if (config.tradeAllocationPct > 0 && balanceCents > 0) {
    const budget = (balanceCents * config.tradeAllocationPct) / 100;
    const byAlloc = Math.floor(budget / Math.max(1, priceCents));
    n = Math.min(n, byAlloc);
  }
  return Math.max(0, n);
}

async function sendTelegramIfConfigured(report: ScanReport): Promise<void> {
  if (!config.telegramEnabled) return;
  if (!config.telegramBotToken || !config.telegramChatId) {
    console.warn("[Telegram] TELEGRAM_ENABLED but missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID");
    return;
  }
  const summary = formatScanSummaryForTelegram(report);
  const ok = await sendTelegramMessages(
    config.telegramBotToken,
    config.telegramChatId,
    summary
  );
  if (!ok) console.warn("[Telegram] one or more messages failed");
}

async function executeTradesForReport(report: ScanReport): Promise<void> {
  if (config.tradeMode === "off") return;

  const dryRun = config.tradeMode === "dry_run" || config.mockMode;
  if (config.tradeMode === "live" && config.mockMode) {
    console.warn("[Trade] MOCK_MODE=true — forcing dry run for orders");
  }

  const planned = planOrdersFromAlerts(report.alerts, config.tradeAlertTypes);
  const seen = new Set<string>();
  const unique = planned.filter((p) => {
    const k = `${p.ticker}:${p.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const maxOrders = config.tradeMaxOrdersPerScan;
  const toRun = maxOrders > 0 ? unique.slice(0, maxOrders) : unique;

  if (toRun.length === 0) return;

  let balanceCents = 0;
  if (!dryRun && !config.mockMode && config.tradeAllocationPct > 0) {
    try {
      balanceCents = await fetchBalanceCents();
    } catch {
      balanceCents = 0;
    }
  }

  for (const plan of toRun) {
    const quote = await getYesNoQuoteCents(plan.ticker);
    if (!quote) {
      console.warn(`[Trade] no quote for ${plan.ticker}, skip`);
      continue;
    }
    const { priceCents, postOnly } = limitPriceForBuy(
      plan.side,
      quote,
      config.tradeExecution,
      config.tradePriceBufferCents
    );
    const count = computeContractCount(priceCents, balanceCents);
    if (count < 1) {
      console.warn(`[Trade] size 0 for ${plan.ticker} at ${priceCents}c — check TRADE_MAX_SPEND_CENTS / ALLOCATION`);
      continue;
    }

    const msg =
      `${dryRun ? "[dry_run]" : "[live]"} ${plan.reason}\n` +
      `${plan.side.toUpperCase()} ${plan.ticker} x${count} @${priceCents}c ${postOnly ? "post_only" : "may_take"}`;

    console.log(msg);

    if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
      await sendTelegramMessages(config.telegramBotToken, config.telegramChatId, msg);
    }

    const effectiveDry = dryRun || config.mockMode;
    const res = await placeKalshiLimitOrder({
      ticker: plan.ticker,
      side: plan.side,
      count,
      priceCents,
      postOnly,
      dryRun: effectiveDry,
    });

    if (!res.ok && res.error) {
      console.error(`[Trade] order failed: ${res.error}`);
      if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
        await sendTelegramMessages(
          config.telegramBotToken,
          config.telegramChatId,
          `Order FAILED ${plan.ticker}: ${res.error}`
        );
      }
    } else if (res.orderId && !effectiveDry) {
      if (config.telegramEnabled && config.telegramBotToken && config.telegramChatId) {
        await sendTelegramMessages(
          config.telegramBotToken,
          config.telegramChatId,
          `Order OK id=${res.orderId} ${plan.ticker} ${plan.side} x${count} @${priceCents}c`
        );
      }
    }
  }
}

/** Scan, print full report, optional Telegram + trading. */
export async function runScanWithNotifications(): Promise<ScanReport> {
  const report = await runScan();
  console.log(formatReport(report));

  await sendTelegramIfConfigured(report);
  await executeTradesForReport(report);

  return report;
}
