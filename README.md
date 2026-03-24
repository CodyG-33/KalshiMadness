# KalshiMadness

Scans [Kalshi](https://kalshi.com/) open markets (configurable series) for **heuristic** pricing inconsistencies between related NCAA-style contracts—for example, a team **winning a game** vs **advancing to the Sweet 16 / Elite Eight / Final Four**.

It also **groups tournament props** next to game lines so you can cross-check:

- **Round-of-8 (Elite Eight) qualifiers** vs individual game moneylines and “team X advances…” markets  
- **Highest numerical seed to reach the Elite Eight** (tail upset paths vs game-level prices)  
- **Number of upsets in the Round of 16 / Sweet 16** (aggregate of correlated games — usually needs a small simulation or careful settlement rules)  
- **How many #1 seeds reach the Elite Eight** (compare to per–1-seed path probabilities)

Automatic checks are limited: the scanner flags simple **ordering** mistakes (e.g. P(advance to E8) > P(advance to S16) for the same team) and **large gaps** between paired heuristics. Aggregate props are listed under **prop buckets** with a short **playbook** in the report; full consistency usually requires your own joint model.

This is **not** financial advice. Settlement rules differ; confirm every pair before trading.

## References

- **[infraform/polymarket-kalshi-arbitrage-bot](https://github.com/infraform/polymarket-kalshi-arbitrage-bot)** — `kalshi-typescript` usage, RSA PEM handling in `.env`, `PortfolioApi` / `MarketApi` patterns.
- **[ryanfrigo/kalshi-ai-trading-bot](https://github.com/ryanfrigo/kalshi-ai-trading-bot)** — Kalshi RSA signing model (PEM file), NCAAB-focused workflow ideas; optional AI keys in `.env` for future integration.

## Setup

```bash
cd KalshiMadness
npm install
cp .env.example .env   # then edit .env with your keys (never commit .env)
```

Fill **`.env`** with your Kalshi API key id and either **`KALSHI_PRIVATE_KEY_PATH`** (PEM file in the project folder) or **`KALSHI_PRIVATE_KEY_PEM`** (single quoted line with `\n`). If both are set, a **non-empty key file wins** so a leftover placeholder `KALSHI_PRIVATE_KEY_PEM` from `.env.example` does not break signing.

### `DECODER routines::unsupported` / `ERR_OSSL_UNSUPPORTED`

Usually a **bad or placeholder private key** is being loaded: remove fake `YOUR_BASE64...` text from `KALSHI_PRIVATE_KEY_PEM` when using `kalshi_private_key.pem`, confirm the file is ~1.5k+ bytes (`wc -c`), and run `npm install` so the `kalshi-typescript` OpenSSL 3 patch runs.

## GitHub (collaborate)

1. On [GitHub](https://github.com/new), create a **new repository** (empty, no README if you already have one locally).
2. In the project folder:

```bash
cd KalshiMadness
git init
git add .
git commit -m "Initial commit: KalshiMadness scanner"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

3. **Invite your friend:** GitHub repo → **Settings → Collaborators** → add their GitHub username.
4. They clone, install, and use their **own** `.env` (keys stay local; `.env` is gitignored).

```bash
git clone https://github.com/YOUR_USERNAME/YOUR_REPO.git
cd YOUR_REPO
npm install
cp .env.example .env
# edit .env
```

## Commands

| Command | Purpose |
|--------|---------|
| `npm run scan` | One-shot scan |
| `npm run scan:watch` | Repeat every `SCAN_LOOP_INTERVAL_SEC` |
| `npm run balance` | Cash + portfolio value (USD) |

Scans print **tradable pairs only**: **Elite Eight advance** (Kalshi `…26E8…` tickers) vs **the same team’s** `*GAME*` series moneyline (from `KALSHI_SCAN_SERIES`). Rows are sorted by **smallest `|Δp|` first**. **Alerts** use the same definition and ignore pairs with `|Δp| > MAX_TRADABLE_COMPARE_GAP` (default 10%) as non-comparable noise.

Dry test without keys:

```bash
MOCK_MODE=true npm run scan
```

## Configuration

| Variable | Meaning |
|----------|---------|
| `KALSHI_SCAN_SERIES` | Comma-separated series tickers (verify live names on Kalshi) |
| `MIN_EQUIV_PROB_GAP` | Minimum \|Δ implied YES\| to flag tradable E8 advance vs game (default 0.015) |
| `MAX_TRADABLE_COMPARE_GAP` | Skip alerts when \|Δp\| exceeds this (default 0.10) |
| `MAX_ADVANCE_OVER_WIN` | Flag if P(E8 advance) exceeds P(game) by more than this |

Tune **`src/classify-market.ts`** (win vs advance wording) and **`src/tournament-props.ts`** (seed / upset / aggregate patterns) when Kalshi copy differs.

Add every relevant **series ticker** to `KALSHI_SCAN_SERIES` so game markets and bracket props land in the same run.

## Telegram

1. Open Telegram, talk to [@BotFather](https://t.me/BotFather), create a bot, copy the **token**.
2. Start a chat with your bot, send any message.
3. Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and read `message.chat.id` — that is **`TELEGRAM_CHAT_ID`** (for DMs it is your user id).
4. In `.env`: `TELEGRAM_ENABLED=true`, `TELEGRAM_BOT_TOKEN=...`, `TELEGRAM_CHAT_ID=...`.

Each `npm run scan` sends a **short alert summary** (first 25 alerts). If trading is on, you also get a line per planned order and success/failure for live orders.

## Trading (optional)

| Variable | Purpose |
|----------|---------|
| `TRADE_MODE` | `off` (default) — no orders. `dry_run` — log + Telegram only. `live` — real limit **buy** orders. |
| `TRADE_EXECUTION` | `taker` — limit near **ask** (+ `TRADE_PRICE_BUFFER_CENTS`), more likely to fill. `maker` — **post-only** at bid+1¢, rests as maker, may not fill. |
| `TRADE_MAX_CONTRACTS` | Cap contracts per order. |
| `TRADE_MAX_SPEND_CENTS` | Cap total cents per order ≈ `contracts × limit price`. |
| `TRADE_ALLOCATION_PCT` | If greater than 0, also cap using `balance × pct / price`. |
| `TRADE_MAX_ORDERS_PER_SCAN` | Max distinct orders per scan (dedupes same ticker+side). |

**Heuristic mapping** (not financial advice): `equiv_gap` → buy **YES** on the lower-implied leg; `ordering_violation` / `advance_monotonicity` → buy **NO** on the named market. This is **not** guaranteed arbitrage; tune `TRADE_ALERT_TYPES` or keep `TRADE_MODE=dry_run` until you trust the logic.

## License

MIT. Third-party repos retain their own licenses.
