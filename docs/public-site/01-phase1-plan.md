# Public site, phase 1 plan

Date: 2026-11-24. Status: plan, not started. Not legal advice: the legal points are things to confirm with a lawyer
or the bodies named.

## 1. The idea
Your own domain, free for everyone for now:
- **Visitors (no login):** a few backtests and scans a day.
- **Logged-in users:** no limits.
- **Users can connect their own broker** (Kite first, others later) for their own live data.
- **Later phases:** community and research pages, then paid subscriptions.
- **A super admin** sees users, usage, and the research and strategies users save.

## 2. Guardrails (decide the design)
1. **Your Kite data never goes to the public.** Kite Connect data is for your personal use.
2. **Bought or downloaded data is also never shown publicly.** That covers the Cloud Trader Pro data ("educational and backtesting purposes") and any other vendor data.
3. **No Yahoo data in the product.** Its terms forbid commercial use.
4. **Public prices come only from NSE's official end-of-day files, and only once NSE allows it.** TrueData told us any NSE price redistribution on a site needs NSE's written permission. You emailed NSE (marketdata@nse.co.in); there's no reply yet.
5. **A user's broker data is shown only to that user.** One user's data never reaches another user or the public.
6. **Broker API secrets and tokens are stored encrypted.** No admin screen ever shows them.
7. **The personal app stays on your PC**: Trade lab, paper tests, the autopilot, recorded option minutes, your Kite session. The public site is a separate deployment.

## 3. Blockers before a PUBLIC launch
| Blocker | Why | Who |
|---|---|---|
| NSE permission or licence for end-of-day data | Showing NSE prices publicly | You (follow up the email; a licence may have a fee) |
| A registered company (Pvt Ltd or LLP) | NSE and TradingView sign data licences only with companies; also contracts and payments later | You |
| Privacy policy, terms, disclaimer | DPDP Act 2023 (consent and purpose); not SEBI-registered, education only | Lawyer review |

**Until these are cleared:** build everything, run it on the real domain as a **private beta** (invite-only, a handful of testers), and switch it to public when the blockers clear. A private beta still shows NSE data to other people, so keep it small and say "beta, not public" in its terms.

## 4. Data plan
| Use | Source | Who sees it |
|---|---|---|
| Charts, screener, backtests, option lab (end of day) | NSE's daily files, downloaded automatically after market close (already built: `apps/feed` EOD + F&O sync) | Everyone, once NSE allows it |
| Live and intraday prices, minute charts | The user's **own** broker connection | That user only |
| Your research (minute data, vendor data, recorded options) | PC only | You only |

The "if Kite isn't connected, get it from NSE after market hours" part of your idea is already how the app works. On the server it becomes a scheduled job, with no Kite needed.

## 5. Accounts and limits
- **Login:** Google sign-in. The database already has the user, session and account tables from the old web app, using better-auth.
- **Visitors:** the existing limit, 5 runs a day per visitor and 20 per IP, on backtests, scans and studies. Signing in removes it.
- **Roles:**
  - **visitor**
  - **user**
  - **admin** (super admin)
  - **creator** (phase 3)
- **Super admin pages:**
  - users and sign-ups
  - daily usage per tool
  - each user's saved screens, strategies and backtests (read-only)
  - errors
  - It never shows broker secrets. The privacy policy says plainly what admins can see.

## 6. What phase 1 includes
- Home, Screener, Charts (D/W/M), Backtest (equity), Option lab (end of day), Research pages, Learn
- Login, Settings, Saved items, Watchlists
- **Connect your broker (Kite):** the user brings their own Kite Connect app key and secret (Kite Connect has its own fees per developer app; check current pricing). It unlocks their live quotes and intraday charts, for them only.
- Legal pages, cookie notice, contact, feedback

**Not in phase 1:** community and editor pages, paid subscriptions, order placing, alerts by WhatsApp.

## 7. Phase 3 preview (community), so phase 1 doesn't block it
- **The content decides, not the label.** SEBI's Avadhut Sathe order (October 2026: ₹546 crore refund, ₹11.5 crore penalty, 2-year ban) rejected an "education" defence for stock-specific, real-time guidance.
- **Paid education and research (agreed with the owner, 2026-11-24):** allowed for anyone, with a consent form and a disclaimer on every page.
  - Allowed content: historical studies, strategy tests, methods, tools, courses.
  - Not allowed: "what to trade now", price targets, live signals, performance claims.
  - Market price data only with SEBI's lag for education: 3 months under the January 2025 rules; a 30-day rule from July 2026 was reported but not confirmed. Check sebi.gov.in before building.
- **The editor enforces it:**
  - a checklist when a page is published
  - the consent form and disclaimer shown on paid pages
  - pages that name a specific stock or option with a current price can be posted only by **SEBI-registered** creators (RA or IA number checked against SEBI's list)
  - no performance claims in paid content
- **Live views for money:** only by registered creators. The owner can register as a Research Analyst (NISM Series XV, then a SEBI application) if wanted later.
- Payments only after a lawyer's opinion.
- Moderation, reporting, and an admin view of every page.

## 8. Hosting
- **One cloud server in an India region (Mumbai).**
  - The feed keeps years of history in memory, so start with about **4 vCPU, 16 GB RAM, 100 GB SSD**.
  - Today's data is about 10 GB of database plus 2 GB of files.
- **Postgres** on the same server at first, with **nightly backups** to separate storage.
- **HTTPS and domain:** a reverse proxy (Caddy or Nginx) with automatic certificates.
- **Deploys:** from this repo via git. We keep working in Claude Code and push; the server pulls and restarts. Later, an automatic deploy on push.
- **Jobs:** the nightly NSE download, the SPAN file, backups, and a health check that alerts you on Telegram.
- **Cost:** an estimate, to confirm when picking a provider. Roughly ₹2,000–6,000 a month for the server, plus the domain (about ₹1,000 a year) and any NSE data fee.

## 9. Milestones
1. **Split public and personal: DONE (2026-11-24).**
   - `APP_MODE=public` in `.env` builds and runs the website. Leaving it out runs the owner's app, which is unchanged.
   - The list of owner-only parts is kept in one place, `packages/shared/src/mode.ts`.
   - In public mode:
     - owner pages return 404 and their links are hidden
     - owner routes are refused, both in the website and in the data server
     - the owner's background jobs don't start
     - visitors are anonymous, with the 5-runs-a-day limit, which now also counts scanner runs, strategy backtests and option lab runs
     - saved items read as empty, and saving says "sign-in is coming soon"
   - Tested on spare ports: every owner page and route returned 404, the limit stopped a visitor after 5 runs, and the owner's store was untouched.
2. **Accounts:** Google login, roles, visitor limits back on, a settings page.
3. **Connect your broker (Kite):** each user's own key and secret, encrypted, data only for that user.
4. **Super admin pages.**
5. **Legal pages and consent.** Drafts from me, then a lawyer's review.
6. **Server:** provision it, copy the data, schedule jobs, back up, add the domain and HTTPS, set up a staging copy.
7. **Private beta on the domain:** invite-only, testers' feedback, fixes.
8. **Public launch** when NSE permission and the company are in place.

## 10. Decisions needed from you
- **Domain name.**
- **Cloud provider:** I'll compare two or three on price and India region before choosing.
- **Company registration:** Pvt Ltd or LLP. A chartered accountant can advise.
- **Who the private-beta testers are.**
