import type { Market } from "kalshi-typescript";
import { config } from "./config";
import { getMarketApi } from "./kalshi";

const PAGE = 200;

/** Synthetic markets for MOCK_MODE — no API keys required. */
function mockNcaaMarkets(): Market[] {
  const base = {
    status: "open" as const,
    market_type: "binary" as const,
    created_time: new Date().toISOString(),
    updated_time: new Date().toISOString(),
    open_time: new Date().toISOString(),
    close_time: new Date().toISOString(),
    expiration_time: new Date().toISOString(),
    latest_expiration_time: new Date().toISOString(),
    settlement_timer_seconds: 0,
    response_price_units: "usd_cent" as const,
    yes_bid_dollars: "0.44",
    yes_ask_dollars: "0.46",
    no_bid_dollars: "0.54",
    no_ask_dollars: "0.56",
    last_price_dollars: "0.45",
    yes_bid_size_fp: "100.00",
    yes_ask_size_fp: "100.00",
    volume_fp: "0.00",
    volume_24h_fp: "0.00",
    result: "" as const,
    can_close_early: true,
    fractional_trading_enabled: false,
    open_interest_fp: "0.00",
  };
  return [
    {
      ...base,
      ticker: "KXNCAAMBGAME-MOCK-DUKE",
      event_ticker: "MOCK-EVT-DUKE-R1",
      title: "Duke wins game",
      subtitle: "",
      yes_sub_title: "Duke wins",
      no_sub_title: "Duke does not win",
    },
    {
      ...base,
      ticker: "MOCK-NCAA-DUKE-ADV-S16",
      event_ticker: "MOCK-EVT-DUKE-S16",
      title: "Duke advances to Sweet 16",
      subtitle: "",
      yes_sub_title: "Duke advances",
      no_sub_title: "Duke does not advance",
      yes_bid_dollars: "0.48",
      yes_ask_dollars: "0.52",
      last_price_dollars: "0.50",
    },
    {
      ...base,
      ticker: "KXMARMADROUND-MOCK-26E8-DUKE",
      event_ticker: "MOCK-EVT-DUKE-E8",
      title: "Duke advances to Elite Eight",
      subtitle: "",
      yes_sub_title: "Duke advances",
      no_sub_title: "Duke does not advance",
      yes_bid_dollars: "0.54",
      yes_ask_dollars: "0.58",
      last_price_dollars: "0.56",
    },
    {
      ...base,
      ticker: "MOCK-NCAA-SEEDMAX-E8",
      event_ticker: "MOCK-EVT-PROPS",
      title: "Highest numerical seed to reach the Elite Eight?",
      subtitle: "",
      yes_sub_title: "Yes on 12+ seed",
      no_sub_title: "No",
      yes_bid_dollars: "0.14",
      yes_ask_dollars: "0.18",
      last_price_dollars: "0.16",
    },
    {
      ...base,
      ticker: "MOCK-NCAA-UPSETS-S16",
      event_ticker: "MOCK-EVT-PROPS",
      title: "Exactly 5 upsets in the Sweet 16",
      subtitle: "",
      yes_sub_title: "Exactly 5 upsets",
      no_sub_title: "Not exactly 5",
      yes_bid_dollars: "0.09",
      yes_ask_dollars: "0.11",
      last_price_dollars: "0.10",
    },
    {
      ...base,
      ticker: "MOCK-NCAA-ONESEEDS-E8",
      event_ticker: "MOCK-EVT-PROPS",
      title: "How many #1 seeds reach the Elite Eight?",
      subtitle: "",
      yes_sub_title: "Exactly 3",
      no_sub_title: "Not exactly 3",
      yes_bid_dollars: "0.24",
      yes_ask_dollars: "0.28",
      last_price_dollars: "0.26",
    },
  ] as unknown as Market[];
}

export async function fetchOpenMarketsForSeries(seriesTicker: string): Promise<Market[]> {
  if (config.mockMode) {
    return mockNcaaMarkets().filter((m) => m.ticker.includes("MOCK"));
  }
  const api = getMarketApi();
  const all: Market[] = [];
  let cursor: string | undefined;
  let pageSize: number;
  do {
    const res = await api.getMarkets(
      PAGE,
      cursor,
      undefined,
      seriesTicker,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "open",
      undefined,
      undefined
    );
    const markets = res.data.markets ?? [];
    pageSize = markets.length;
    all.push(...markets);
    cursor = res.data.cursor ?? undefined;
    if (!cursor || pageSize < PAGE) break;
  } while (true);
  return all;
}

export async function fetchAllScanMarkets(): Promise<Market[]> {
  const byTicker = new Map<string, Market>();
  for (const series of config.scanSeries) {
    const list = await fetchOpenMarketsForSeries(series);
    for (const m of list) {
      byTicker.set(m.ticker, m);
    }
  }
  return [...byTicker.values()];
}
