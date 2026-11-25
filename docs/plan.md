# hamara plan — current version (single user)

## What we are building now
- Personal finance for **one person** and their own bank accounts.
- Telegram bot + Mini App, no native app. The bot only opens the Mini App and receives files/text; the real work is inside the Mini App.
- Allowlist access by Telegram user id only; not open to anyone else.
- Cloudflare Workers + D1 (+R2 if needed), no server; a server only if a limitation (e.g. PDF parsing) forces it.

A shared account and separating/joining two people comes later — not designed now.

## Inputs (in real order)
1. Bank statement files (CSV/PDF account-report exports) — the main path.
2. Bank SMS text sent to the bot — for testing and starting; templates in `parsers.md`.
3. Manual entry only inside the Mini App, never as bot text commands.
4. Activating bank SMS + automatic Android SMS reading — later, optional.

## Display and reports
- Light/dark themes; light looks like the Wepod account-turnover card list, grouped by day.
- Top chips: "All" + each added bank. Transfer type (Paya / card-to-card / …) lives inside a corner filter icon.
- Filters combine across dimensions (bank × category × type) but are single-select within each dimension — a transaction cannot be both Paya and card-to-card, sit in two banks, or sit in two categories.
- Note/tag and category visible on the list card itself, not hidden in details.
- Category color in settings, applied to icon, label, and card border.
- Charts: category donut/pie + monthly income/expense bars. Internal transfers between own banks get their own chart category but are excluded from income/expense totals.
- Export: transactions to Excel/Sheet (CSV) + settings export.

## Open decisions
1. Base: fork the tapwork-kz architecture or build from scratch with the same Workers+D1 pattern?
2. What are the real columns of the Wepod CSV export? Without a sample (even just headers) the Wepod adapter cannot be built. PDF on Workers also needs a test.
3. Internal-transfer matching rule (equal amount + what time window?) and the year rule for Pasargad's year-less dates at the boundary.
