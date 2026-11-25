# Phase 1 build list

## Setup (once)
1. `npm install`
2. `npx wrangler login`
3. `npm run db:create` — put the returned `database_id` in `wrangler.toml`
4. `npm run db:schema`
5. Create the bot in BotFather; check the hamara username is not taken
6. Secrets: `wrangler secret put TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`
7. `ALLOWED_TELEGRAM_ID` in `wrangler.toml` = the owner's numeric Telegram id
8. `npm run deploy`, then set the Telegram webhook to `/telegram` with the same secret

## Phase 1 — core
- [ ] `/start` → button opening the Mini App (allowlist only)
- [ ] SMS parsers for Tejarat/Pasargad/Mellat per `parsers.md` + fixture tests
- [ ] Wepod CSV adapter (after seeing real headers) + dedup hash
- [ ] Internal-transfer detection, excluded from income/expense totals
- [ ] Transaction list API with bank × category × type filters
- [ ] Categories + colors in settings; note on the card
- [ ] Category donut chart + monthly bar chart
- [ ] CSV export of transactions + settings export

## Phase 2 — Mini App
- [ ] Wepod-like card UI, light/dark themes, RTL + Jalali calendar
- [ ] Telegram `initData` validation on `/app` and the API
