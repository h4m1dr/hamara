# Phase 1 build list

## Setup (once)
1. `npm install`
2. `npx wrangler login`
3. `npm run db:create` — put the returned `database_id` in `wrangler.toml`
4. `npm run db:schema`
5. Create the bot in BotFather; check the hamara username is not taken
6. Secrets (production, Cloudflare side): `wrangler secret put TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Never put secrets in `wrangler.toml` or git.
7. `ALLOWED_TELEGRAM_ID` in `wrangler.toml` = the owner's numeric Telegram id (not a secret).
8. Local copy for tooling: copy `.dev.vars.example` to `.dev.vars` and fill it in (`.dev.vars` is gitignored — never commit it).
9. `npm run deploy`, then `npm run webhook` (reads `.dev.vars`, sets the Telegram webhook to `/telegram` with the same secret — no token in the command line).

## Phase 1 — core
- [x] `/start` → button opening the Mini App (allowlist only); SMS text and CSV files get confirmation replies
- [x] SMS parsers for Tejarat/Pasargad/Mellat per `parsers.md` + fixture tests (`npm run test:parsers`)
- [x] Statement CSV adapter (generic Persian/English header detection) + dedup hash — exact Wepod headers still unconfirmed, verify on first real file
- [x] Internal-transfer detection, excluded from income/expense totals — provisional rule: opposite equal amount in another bank within 48h
- [x] Transaction list API with bank × category × type filters
- [x] Categories + colors; note on the card; theme setting
- [x] Category donut chart + monthly bar chart (stats API + functional Mini App page; Wepod polish is Phase 2)
- [x] CSV export of transactions + settings API
- [x] Telegram `initData` validation on the API

## Phase 2 — Mini App
- [x] Wepod-like card UI (day-grouped cards, bank chips, corner filter panel), light/dark themes, RTL + Jalali calendar
- [x] Telegram `initData` validation on `/app` and the API (done in Phase 1)
- [x] Manual entry inside the Mini App, category management (name + color), settings export
- [x] Delete: per-transaction (Mini App card + API), bot `/clear` wipes all transactions
