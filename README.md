# hamara

Personal finance management with a Telegram bot and Mini App, on Cloudflare Workers + D1.

[فارسی](README.fa.md)

The name comes from Old Persian *Hamārakara* — "counting/statistics" + "maker" — the ancestor of the modern Persian word for "statistician".

## What it is

One person, their own bank accounts, one simple place to see income and expenses:

- Account-turnover list as cards, like banking apps — with the note and category on the card itself
- Categories with a distinct color each (food red, clothes blue, …)
- Donut/pie chart by category + monthly income/expense bar chart
- Combined filters: bank × category × transfer type
- Light and dark themes
- Excel/Sheet export and settings export

The Telegram bot only opens the Mini App and receives files/text; the real work happens inside the Mini App, not through text commands.

## Status

Initial scaffold — not built or deployed yet.

- [ ] Create the D1 database on Cloudflare and put `database_id` in `wrangler.toml`
- [ ] Create the bot in BotFather and set the webhook
- [ ] Phase 1: inputs (SMS text + statement files), list, categories/colors, charts
- [ ] Phase 2: full Mini App with the card UI

Details: [`docs/plan.md`](docs/plan.md) — build list: [`docs/build.md`](docs/build.md)

## Inputs

1. Bank statement files (CSV/PDF account-report exports)
2. Bank SMS text sent to the bot (Tejarat/Pasargad/Mellat templates in [`docs/parsers.md`](docs/parsers.md))
3. Manual entry only inside the Mini App

## Access

Not public. Only the configured Telegram user id (`ALLOWED_TELEGRAM_ID`) can open it.

## Stack

TypeScript — Cloudflare Workers + D1 (SQLite) — Telegram Bot API + Mini App (Web App)

## License

MIT — [LICENSE](LICENSE)
