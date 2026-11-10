# Nandibull

A personal trading workspace for Indian markets. It has:

- **Today page:** the trading day at a glance.
- **Screener and Strategies:** a stock screener and a strategy builder with portfolio backtests.
- **Options tools:** the option chain, a strategy builder and a simulator.
- **Charts:** daily to monthly, plus intraday.
- **Alerts:** in-app, Telegram, email and WhatsApp.

Daily history comes from NSE's official end-of-day files. Intraday minutes and live prices come from the owner's **Zerodha Kite Connect** login.

It is a **single-user app**: there is no sign-in yet, so the site listens on `127.0.0.1` only. Don't expose it to a network.

(The repo and internal ids still use the old name: `my-trading-view`, the `@mtv/*` packages, the `mytradingview` database.)

---

## Quick start

**Needs:** Node.js 22 or newer, and Windows, macOS or Linux. You don't need Docker or a Postgres install, because the database runs embedded.

```bash
npm install                      # also generates the Prisma client
cp .env.example .env             # fill in the values (see "Environment")
npm run db:start                 # terminal 1: creates .pgdata/ on the first run; leave it running
npm run deploy -w @mtv/db        # terminal 2: apply database migrations (first time, and after pulling new ones)
npm run platform                 # terminal 2: builds the site, then starts the data service and the site
```

Open **http://127.0.0.1:3100**. To get live prices and intraday data, click **Connect Kite** in the top bar during market hours.

> **Start the database first.** `npm run platform` doesn't start it. Without it, the data service stays on "NSE history is loading" for ever.

### Day-to-day

| What you want | Command |
|---|---|
| Start the database | `npm run db:start` (keep it running) |
| Start the app (production build, lighter) | `npm run platform` |
| Develop with hot reload | `npm run platform:dev` |
| After site changes | stop `npm run platform` and run it again (it rebuilds) |
| After data-service changes | a restart is enough |

### Start-up time

The data service keeps all NSE history in memory:

- **Normal start:** it reads `apps/feed/.data/eod-snapshot.bin`, which takes a few seconds.
- **First start:** with no snapshot yet, it reads the database instead. That takes 1–2 minutes, and the snapshot is saved for next time.

Until the history is loaded, data pages answer "NSE history is loading" and retry on their own. `GET http://127.0.0.1:4001/health` answers as soon as the service is up.

The service uses about 3–4 GB of memory, with a 6 GB ceiling.

---

## What's in the app

| Page | What it does |
|---|---|
| `/today` | Greeting and market state, then index tiles (3-month line chart and day range, live during the session). Below: the "Needs you" card (alerts and day rules), watchlist, NIFTY 500 breadth, NIFTY 50 movers, FII footprint, options snapshot, sudden volume, sectors and key levels |
| `/screener` | Condition builder (groups, NOT, AND/OR per row, a timeframe per condition) or formula mode. 32 ready-made screens, saved screens with run history, results to a watchlist, refresh every minute for intraday screens |
| `/strategies` | Six-step strategy builder and portfolio backtests on NSE history: all NSE stocks (delisted included), an index's stocks, a watchlist, or picked stocks and **indices**. Results include charges, the NIFTY benchmark, a list of what was left out and why, and a CSV export |
| `/options`, `/options/[tool]` | Option chain, strategy builder (margin, charges per broker, what-if), simulator, OI, PCR, max pain, IV, GEX and other tools |
| `/backtest/options` | Option strategy backtests leg by leg |
| `/chart/[symbol]` | Charts on 1m, 5m, 15m and 1h (Kite minutes), and daily, weekly and monthly (NSE). Indicators, drawings, compare, bar replay |
| `/alerts` | Alerts on saved screens and strategies: in-app (bell with chime), Telegram, email, WhatsApp |
| `/watchlists` | Watchlists; "Screen this list" opens the screener on one |
| `/tools` | Everything else as cards: futures, market tools (RRG, breadth), research (condition study, NIFTY day by day, FII), learn, practice, utilities, Kite connection (`/connect`) |

**Trading mode:** the Today page has an Intraday / Swing / Positional switch. When you change it, the app does two things once:

- **Screener:** lists that mode's ready-made screens first, and moves an unsaved screen to 5-minute or daily bars.
- **Charts:** open on 5-minute, daily or weekly bars.

After that, your own choices hold until you switch mode again.

**Indices in Strategies:** you can't buy an index, so it's tested as a stand-in for index futures or an index ETF:

- quantity is in index units (1 unit gains ₹1 per point)
- charges are at futures rates
- no traded-value check, because NSE's index files carry no volume
- futures premium, rollover and lot sizes are not modelled

A rule that uses volume never fires on an index. When only indices are tested, such a rule is refused with a message.

**Theme:** light by default, dark from the top bar. All dialogs are the app's own, in both themes.

---

## Data

Daily data comes from NSE's public archives, plus NSDL for FPI flows. The data service downloads new files every evening and stores them in Postgres.

- **Stocks:** daily from 2011-06-22, adjusted for corporate actions (rights use NSE's TERP formula).
- **Indices:** closes from NSE's own index files. There is no volume.
- **F&O:** NIFTY and BANKNIFTY end of day; options history fills backwards over time.
- **Flows:** participant OI from 2012, FII derivatives statistics from 2014, NSDL FPI daily flows.
- **Margin:** SPAN margin from NSE's SPAN files.
- **Intraday (Kite):** 1-minute bars for about 520 instruments (NIFTY 500 and F&O names).
  - Stored in `apps/feed/.data/1m`.
  - The first connection back-fills `INTRADAY_HISTORY_DAYS` (default 365).
  - Each day is corrected after the close (15:50) against Kite's history.
  - Minutes are put on NSE's adjusted basis, so intraday and daily values agree.
- **Option recorder:** NIFTY and BANKNIFTY, ATM ±10 strikes, two expiries, with OI and bid/ask, recorded from the live feed.
- **Your data:** screens, strategies, watchlists, alerts and settings live in `.userdata/user.json`.

**Accuracy rule:** where data has gaps or breaks, the app flags them and never fills them in. Known gaps:

- Kite's own history has no minutes after 15:14 from 3 Aug to 30 Oct 2026.
- Summed minute volume is 0.6–2.6% below NSE's day total, because NSE also counts trades outside the continuous session.

---

## Ports

| Service | Port | Notes |
|---|---|---|
| Site (Next.js) | 3100 | `apps/platform`, bound to 127.0.0.1 |
| Data service (Fastify) | 4001 | `apps/feed`, set by `FEED_PORT` |
| Postgres (embedded) | 5434 | data in `.pgdata/` (git-ignored) |

The site calls the data service from its own server (`/api/...` is passed through with a signed token), so the browser never talks to port 4001.

---

## Project layout

npm workspaces monorepo:

```
apps/
  platform/     The app: Next.js pages and UI (Today, Scanner, Strategies, Options, Charts, Tools)
  feed/         Data service: NSE downloads, history in memory, Kite login, live ticks and minutes, screener,
                backtests, alerts, the owner's saved data
packages/
  rules/        Condition language: parser, evaluator, 90+ functions, candlestick patterns, presets
  backtest/     Portfolio backtest engine, options backtest and simulator, condition study
  indicators/   Technical indicators (checked bar by bar against reference values)
  options/      Option pricing, Greeks, payoff, SPAN margin
  paper/        Charges (equity, futures, options; per broker), paper ledger, order matching
  db/           Prisma schema, migrations, embedded Postgres script
  shared/       Types and helpers shared by the apps
```

---

## Environment

Copy `.env.example` to `.env`. Never commit `.env`; it's git-ignored. The main variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres. Locally `postgresql://postgres:postgres@localhost:5434/mytradingview` |
| `FEED_TOKEN_SECRET` | Long random secret; the site signs its requests to the data service with it |
| `FEED_PORT`, `FEED_URL` | Data service port, and where the site finds it (default `http://127.0.0.1:4001`) |
| `KITE_API_KEY`, `KITE_API_SECRET` | Your Kite Connect app. Set its redirect URL to `http://127.0.0.1:4001/api/kite/callback` |
| `PLATFORM_URL` | Where the Kite login returns to (default `http://127.0.0.1:3100`) |
| `INTRADAY_HISTORY_DAYS` | How far back the first minute back-fill goes (default 365) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Telegram alerts |
| `RESEND_API_KEY`, `ALERT_EMAIL_FROM`, `ALERT_EMAIL_TO` | Email alerts (Resend) |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_TO`, `WHATSAPP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` | WhatsApp alerts (Meta Cloud API, approved template) |
| `EOD_BACKFILL_FROM`, `FNO_BACKFILL_FROM`, `PARTICIPANT_BACKFILL_FROM`, `FII_STATS_BACKFILL_FROM` | How far back the first NSE download goes |
| `FEED_NO_SYNC`, `FEED_NO_LIVE`, `FEED_NO_ALERTS` | Set to `1` to run a second data service for testing without downloads, live data or alerts |

---

## Database

- Schema: `packages/db/prisma/schema.prisma`
- Apply migrations: `npm run deploy -w @mtv/db`
- Create a migration in dev: `npm run db:migrate`
- Regenerate the client: `npm run generate -w @mtv/db`

**Stop the app before running migrations or `generate`.** On Windows, a running process locks the Prisma engine file and you get an `EPERM` error.

---

## Checks

```bash
npm test              # all unit tests (vitest) across workspaces
npm run typecheck     # TypeScript in every workspace
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "NSE history is loading" for minutes | The database isn't running. Start `npm run db:start`, then restart `npm run platform` |
| Page shows "Application error" after a change | Don't rebuild while the app runs. Stop `npm run platform` and start it again |
| No live prices or intraday bars | Click **Connect Kite**. The Kite login lasts until early next morning, so connect again each trading day |
| `EPERM` from Prisma | Stop the app and retry |
| Port already in use | An old node process is still listening. Find it with `Get-NetTCPConnection -LocalPort 3100` (or 4001) in PowerShell and end it |

---

## Disclaimer

This is research and education software. It gives no investment advice, and past results don't predict future returns. Third-party licences are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
