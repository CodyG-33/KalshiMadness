import { Configuration, MarketApi, PortfolioApi } from "kalshi-typescript";
import { config, findKalshiPrivateKeyPem } from "./config";

/** PEM string for kalshi-typescript; file path + default kalshi_private_key.pem beat short env placeholders. */
function loadPrivateKeyPemForApi(): string {
  if (config.mockMode) return "";
  return findKalshiPrivateKeyPem();
}

export function buildKalshiConfiguration(): Configuration {
  const pem = loadPrivateKeyPemForApi();
  return new Configuration({
    apiKey: config.apiKey,
    basePath: config.basePath,
    ...(pem ? { privateKeyPem: pem } : {}),
  });
}

let cachedMarketApi: MarketApi | null = null;
export function getMarketApi(): MarketApi {
  if (!cachedMarketApi) cachedMarketApi = new MarketApi(buildKalshiConfiguration());
  return cachedMarketApi;
}

export async function fetchBalanceUsd(): Promise<{ balanceUsd: number; portfolioUsd: number }> {
  const portfolioApi = new PortfolioApi(buildKalshiConfiguration());
  const res = await portfolioApi.getBalance();
  const balance = res.data.balance ?? 0;
  const portfolio = res.data.portfolio_value ?? 0;
  return {
    balanceUsd: balance / 100,
    portfolioUsd: portfolio / 100,
  };
}

/** Available trading balance in cents (Kalshi API). */
export async function fetchBalanceCents(): Promise<number> {
  const portfolioApi = new PortfolioApi(buildKalshiConfiguration());
  const res = await portfolioApi.getBalance();
  return res.data.balance ?? 0;
}
