// hamara — Cloudflare Worker: Telegram webhook + Mini App
// Scaffold only: routes and allowlist checks are in place, features are TODO.

export interface Env {
  DB: D1Database;
  ALLOWED_TELEGRAM_ID: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return json({ ok: true, app: "hamara" });
    }

    if (url.pathname === "/telegram" && request.method === "POST") {
      // Telegram webhook: secret token + allowlist (single user for now)
      if (
        request.headers.get("x-telegram-bot-api-secret-token") !==
        env.TELEGRAM_WEBHOOK_SECRET
      ) {
        return json({ ok: false }, 401);
      }
      const update = (await request.json()) as {
        message?: { from?: { id?: number }; text?: string; chat?: { id?: number } };
      };
      const fromId = String(update.message?.from?.id ?? "");
      if (fromId !== env.ALLOWED_TELEGRAM_ID) {
        return json({ ok: true }); // silently ignore everyone else
      }
      // TODO Phase 1: /start -> open Mini App button; text -> SMS parser; file -> statement import
      return json({ ok: true });
    }

    if (url.pathname === "/app") {
      // TODO Phase 2: Telegram Mini App (card list, filters, charts). Validate initData here.
      return new Response(
        "<!doctype html><html lang='en'><meta charset='utf-8'><title>hamara</title><body>hamara — coming soon</body></html>",
        { headers: { "content-type": "text/html; charset=utf-8" } },
      );
    }

    if (url.pathname === "/api/transactions") {
      // TODO Phase 1: list with filters bank x category x kind (single-select per dimension)
      return json({ ok: true, items: [] });
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};
