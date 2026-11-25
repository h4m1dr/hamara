// hamara — Cloudflare Worker: Telegram bot + Mini App + API (Phase 1 core)
// Bot: /start opens the Mini App; SMS text and statement CSV files are
// imported with confirmation replies. Real work (list, categories, charts,
// export) happens in the Mini App through the API below.
// Access: single-user allowlist (ALLOWED_TELEGRAM_ID). API calls from the
// Mini App are authenticated with Telegram initData HMAC.

import { parseSmsBulk, parseStatementCsv, type ParsedTransaction } from "./parsers";
import { APP_HTML } from "./app";

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

// ---------- Telegram helpers ----------

async function tgSend(env: Env, chatId: number, text: string, appUrl?: string) {
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (appUrl) {
    body.reply_markup = {
      inline_keyboard: [[{ text: "باز کردن همرا", web_app: { url: appUrl } }]],
    };
  }
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function tgDownloadFile(env: Env, fileId: string): Promise<string | null> {
  const info = await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(fileId)}`,
  ).then((r) => r.json()) as { ok?: boolean; result?: { file_path?: string } };
  if (!info.ok || !info.result?.file_path) return null;
  const res = await fetch(
    `https://api.telegram.org/file/bot${env.TELEGRAM_BOT_TOKEN}/${info.result.file_path}`,
  );
  return res.ok ? res.text() : null;
}

// Validate Telegram Mini App initData (HMAC-SHA256 with "WebAppData" key).
async function validateInitData(initData: string, botToken: string): Promise<number | null> {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`).join("\n");
    const enc = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
      "raw", enc.encode("WebAppData"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const secret = await crypto.subtle.sign("HMAC", secretKey, enc.encode(botToken));
    const key = await crypto.subtle.importKey(
      "raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(check));
    const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (hex !== hash) return null;
    const user = JSON.parse(params.get("user") ?? "{}") as { id?: number };
    return user.id ?? null;
  } catch {
    return null;
  }
}

// ---------- storage ----------

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function bankId(env: Env, bank: ParsedTransaction["bank"]): Promise<number> {
  const name = { tejarat: "Tejarat", pasargad: "Pasargad/Wepod", mellat: "Mellat" }[bank];
  const row = await env.DB.prepare("SELECT id FROM banks WHERE name = ?").bind(name)
    .first<{ id: number }>();
  if (row) return row.id;
  const ins = await env.DB.prepare("INSERT INTO banks (name) VALUES (?)").bind(name).run();
  return Number(ins.meta.last_row_id);
}

// Provisional internal-transfer rule (open decision, adjust later):
// opposite equal amount in a different bank within 48 hours => both internal.
async function detectInternal(env: Env, txId: number, bank: number, amount: number, occurredAt: string) {
  const other = await env.DB.prepare(
    `SELECT id FROM transactions
     WHERE id != ? AND bank_id != ? AND amount_rial = ? AND is_internal = 0
       AND ABS(julianday(occurred_at) - julianday(?)) <= 2
     ORDER BY ABS(julianday(occurred_at) - julianday(?)) LIMIT 1`,
  ).bind(txId, bank, -amount, occurredAt, occurredAt).first<{ id: number }>();
  if (other) {
    await env.DB.prepare("UPDATE transactions SET is_internal = 1 WHERE id IN (?, ?)")
      .bind(txId, other.id).run();
  }
}

async function saveTransaction(
  env: Env, tx: ParsedTransaction, source: string,
): Promise<"added" | "duplicate"> {
  const bank = await bankId(env, tx.bank);
  const dedup = await sha256Hex(
    `${tx.bank}|${tx.amountRial}|${tx.occurredAt}|${tx.balanceRial ?? ""}`,
  );
  try {
    const ins = await env.DB.prepare(
      `INSERT INTO transactions
         (bank_id, amount_rial, balance_rial, kind, note, occurred_at, source, dedup_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(bank, tx.amountRial, tx.balanceRial ?? null, tx.kind ?? null,
      tx.note ?? null, tx.occurredAt, source, dedup).run();
    await detectInternal(env, Number(ins.meta.last_row_id), bank, tx.amountRial, tx.occurredAt);
    return "added";
  } catch (e) {
    if (String(e).includes("UNIQUE")) return "duplicate";
    throw e;
  }
}

const faNum = (n: number) => Math.abs(Math.round(n / 10)).toLocaleString("fa-IR");

// ---------- worker ----------

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = url.origin;

    if (url.pathname === "/health") return json({ ok: true, app: "hamara" });

    // ----- Telegram webhook -----
    if (url.pathname === "/telegram" && request.method === "POST") {
      if (request.headers.get("x-telegram-bot-api-secret-token") !== env.TELEGRAM_WEBHOOK_SECRET) {
        return json({ ok: false }, 401);
      }
      const update = (await request.json()) as {
        message?: {
          from?: { id?: number }; text?: string; chat?: { id?: number };
          document?: { file_id?: string; file_name?: string };
        };
      };
      const msg = update.message;
      const fromId = String(msg?.from?.id ?? "");
      const chatId = msg?.chat?.id;
      if (!msg || !chatId || fromId !== env.ALLOWED_TELEGRAM_ID) {
        return json({ ok: true }); // silently ignore everyone else
      }

      const text = (msg.text ?? "").trim();

      if (text.startsWith("/clear")) {
        const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM transactions").first<{ n: number }>();
        await env.DB.prepare("DELETE FROM transactions").run();
        await tgSend(env, chatId, `همه تراکنش‌ها پاک شدن (${(count?.n ?? 0).toLocaleString("fa-IR")} تا).`);
        return json({ ok: true });
      }

      if (text.startsWith("/start")) {
        await tgSend(env, chatId,
          "سلام! همرا آماده‌ست.\n\nپیامک بانک رو بفرست تا ثبتش کنم، یا فایل CSV صورتحساب رو بفرست. برای دیدن لیست و نمودار، همرا رو باز کن:",
          `${origin}/app`);
        return json({ ok: true });
      }

      if (msg.document?.file_id) {
        const name = msg.document.file_name ?? "";
        if (!name.toLowerCase().endsWith(".csv")) {
          await tgSend(env, chatId, "فعلاً فقط فایل CSV صورتحساب رو می‌فهمم. فایل PDF رو بعداً اضافه می‌کنیم.");
          return json({ ok: true });
        }
        const csv = await tgDownloadFile(env, msg.document.file_id);
        if (!csv) {
          await tgSend(env, chatId, "فایل رو نتونستم دانلود کنم، دوباره بفرست.");
          return json({ ok: true });
        }
        const rows = parseStatementCsv(csv, "pasargad");
        if (!rows.length) {
          await tgSend(env, chatId, "از این فایل هیچ تراکنشی درنیومد — ستون‌های فایل رو نمی‌شناسم. سرستون‌ها رو برام بفرست تا درستش کنم.");
          return json({ ok: true });
        }
        let added = 0, skipped = 0;
        for (const row of rows) {
          (await saveTransaction(env, row, "statement_csv")) === "added" ? added++ : skipped++;
        }
        await env.DB.prepare(
          "INSERT INTO imports (source, filename, rows_added, rows_skipped) VALUES ('statement_csv', ?, ?, ?)",
        ).bind(name, added, skipped).run();
        await tgSend(env, chatId,
          `فایل خونده شد: ${added.toLocaleString("fa-IR")} تراکنش اضافه شد` +
          (skipped ? `، ${skipped.toLocaleString("fa-IR")} تا تکراری بود و رد شد.` : "."));
        return json({ ok: true });
      }

      if (text) {
        const txs = parseSmsBulk(text, new Date());
        if (!txs.length) {
          await tgSend(env, chatId, "این متن رو به‌عنوان پیامک بانک نشناختم. پیامک تجارت، پاسارگاد/ویپاد یا ملت رو بفرست (می‌تونی چند تا رو با هم توی یه پیام بفرستی)، یا فایل CSV صورتحساب رو.");
          return json({ ok: true });
        }
        let added = 0, skipped = 0;
        for (const tx of txs) {
          (await saveTransaction(env, tx, "sms")) === "added" ? added++ : skipped++;
        }
        if (txs.length === 1) {
          const tx = txs[0];
          const bankFa = { tejarat: "تجارت", pasargad: "پاسارگاد/ویپاد", mellat: "ملت" }[tx.bank];
          const dirFa = tx.amountRial < 0 ? "برداشت" : "واریز";
          await tgSend(env, chatId, added
            ? `ثبت شد: ${dirFa} ${faNum(tx.amountRial)} تومان — ${bankFa}` +
              (tx.balanceRial !== undefined ? `\nمانده: ${faNum(tx.balanceRial)} تومان` : "")
            : "این تراکنش قبلاً ثبت شده بود، دوباره اضافه نشد.");
        } else {
          await tgSend(env, chatId,
            `${added.toLocaleString("fa-IR")} تراکنش ثبت شد` +
            (skipped ? `، ${skipped.toLocaleString("fa-IR")} تا تکراری بود و رد شد.` : "."));
        }
        return json({ ok: true });
      }

      return json({ ok: true });
    }

    // ----- Mini App -----
    if (url.pathname === "/app") {
      return new Response(APP_HTML, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    // ----- API (Mini App, initData-authenticated) -----
    if (url.pathname.startsWith("/api/")) {
      const userId = await validateInitData(request.headers.get("x-telegram-init-data") ?? "", env.TELEGRAM_BOT_TOKEN);
      if (String(userId ?? "") !== env.ALLOWED_TELEGRAM_ID) return json({ ok: false }, 401);

      if (url.pathname === "/api/transactions" && request.method === "GET") {
        const bank = url.searchParams.get("bank");
        const category = url.searchParams.get("category");
        const kind = url.searchParams.get("kind");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
        const where: string[] = [];
        const binds: unknown[] = [];
        if (bank) { where.push("t.bank_id = ?"); binds.push(Number(bank)); }
        if (category === "none") where.push("t.category_id IS NULL");
        else if (category) { where.push("t.category_id = ?"); binds.push(Number(category)); }
        if (kind) { where.push("t.kind = ?"); binds.push(kind); }
        const sql = `SELECT t.*, b.name AS bank_name, c.name AS category_name, c.color AS category_color
          FROM transactions t
          LEFT JOIN banks b ON b.id = t.bank_id
          LEFT JOIN categories c ON c.id = t.category_id
          ${where.length ? "WHERE " + where.join(" AND ") : ""}
          ORDER BY t.occurred_at DESC LIMIT ?`;
        const { results } = await env.DB.prepare(sql).bind(...binds, limit).all();
        return json({ ok: true, items: results });
      }

      if (url.pathname === "/api/transactions" && request.method === "POST") {
        // Manual entry (Mini App only): amount in Toman + direction.
        const body = (await request.json()) as {
          bank_id?: number; amount_toman?: number; direction?: string;
          category_id?: number | null; note?: string | null; occurred_at?: string;
        };
        if (!body.bank_id || !body.amount_toman) return json({ ok: false, error: "bank_id and amount_toman required" }, 400);
        const amountRial = Math.round(body.amount_toman) * 10 * (body.direction === "in" ? 1 : -1);
        const ins = await env.DB.prepare(
          `INSERT INTO transactions (bank_id, category_id, amount_rial, note, occurred_at, source)
           VALUES (?, ?, ?, ?, ?, 'manual')`,
        ).bind(body.bank_id, body.category_id ?? null, amountRial, body.note ?? null,
          body.occurred_at ?? new Date().toISOString()).run();
        return json({ ok: true, id: Number(ins.meta.last_row_id) });
      }

      const catMatch = url.pathname.match(/^\/api\/categories\/(\d+)$/);
      if (catMatch && request.method === "DELETE") {
        await env.DB.prepare("UPDATE transactions SET category_id = NULL WHERE category_id = ?").bind(Number(catMatch[1])).run();
        await env.DB.prepare("DELETE FROM categories WHERE id = ?").bind(Number(catMatch[1])).run();
        return json({ ok: true });
      }

      if (url.pathname === "/api/settings/export" && request.method === "GET") {
        const banks = await env.DB.prepare("SELECT * FROM banks").all();
        const categories = await env.DB.prepare("SELECT * FROM categories").all();
        const settings = await env.DB.prepare("SELECT key, value FROM settings").all();
        return new Response(JSON.stringify({ banks: banks.results, categories: categories.results, settings: settings.results }, null, 2), {
          headers: { "content-type": "application/json; charset=utf-8", "content-disposition": "attachment; filename=hamara-settings.json" },
        });
      }

      const txMatch = url.pathname.match(/^\/api\/transactions\/(\d+)$/);
      if (txMatch && request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM transactions WHERE id = ?").bind(Number(txMatch[1])).run();
        return json({ ok: true });
      }
      if (txMatch && request.method === "PATCH") {
        const body = (await request.json()) as { category_id?: number | null; note?: string | null };
        const sets: string[] = [];
        const binds: unknown[] = [];
        if ("category_id" in body) { sets.push("category_id = ?"); binds.push(body.category_id); }
        if ("note" in body) { sets.push("note = ?"); binds.push(body.note); }
        if (sets.length) {
          await env.DB.prepare(`UPDATE transactions SET ${sets.join(", ")} WHERE id = ?`)
            .bind(...binds, Number(txMatch[1])).run();
        }
        return json({ ok: true });
      }

      if (url.pathname === "/api/banks" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM banks ORDER BY id").all();
        return json({ ok: true, items: results });
      }

      if (url.pathname === "/api/categories" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT * FROM categories ORDER BY id").all();
        return json({ ok: true, items: results });
      }
      if (url.pathname === "/api/categories" && request.method === "POST") {
        const body = (await request.json()) as { name?: string; color?: string; icon?: string };
        if (!body.name) return json({ ok: false, error: "name required" }, 400);
        const ins = await env.DB.prepare("INSERT INTO categories (name, color, icon) VALUES (?, ?, ?)")
          .bind(body.name, body.color ?? "#888888", body.icon ?? null).run();
        return json({ ok: true, id: Number(ins.meta.last_row_id) });
      }

      if (url.pathname === "/api/stats" && request.method === "GET") {
        // Donut: expenses by category; internal transfers are their own slice
        // but excluded from income/expense totals.
        const donut = await env.DB.prepare(
          `SELECT COALESCE(c.name, 'بدون دسته') AS name, COALESCE(c.color, '#888888') AS color,
                  SUM(-t.amount_rial) AS total
           FROM transactions t LEFT JOIN categories c ON c.id = t.category_id
           WHERE t.amount_rial < 0 AND t.is_internal = 0
           GROUP BY c.id ORDER BY total DESC`,
        ).all();
        const internal = await env.DB.prepare(
          "SELECT COALESCE(SUM(-amount_rial), 0) AS total FROM transactions WHERE amount_rial < 0 AND is_internal = 1",
        ).first<{ total: number }>();
        const monthly = await env.DB.prepare(
          `SELECT substr(occurred_at, 1, 7) AS month,
                  SUM(CASE WHEN amount_rial > 0 THEN amount_rial ELSE 0 END) AS income,
                  SUM(CASE WHEN amount_rial < 0 THEN -amount_rial ELSE 0 END) AS expense
           FROM transactions WHERE is_internal = 0
           GROUP BY month ORDER BY month`,
        ).all();
        return json({ ok: true, donut: donut.results, internal_total: internal?.total ?? 0, monthly: monthly.results });
      }

      if (url.pathname === "/api/settings" && request.method === "GET") {
        const { results } = await env.DB.prepare("SELECT key, value FROM settings").all();
        return json({ ok: true, items: results });
      }
      if (url.pathname === "/api/settings" && request.method === "POST") {
        const body = (await request.json()) as Record<string, string>;
        for (const [k, v] of Object.entries(body)) {
          await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(k, String(v)).run();
        }
        return json({ ok: true });
      }

      if (url.pathname === "/api/export.csv" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT t.occurred_at, b.name AS bank, t.amount_rial, t.balance_rial, t.kind,
                  c.name AS category, t.note, t.is_internal, t.source
           FROM transactions t LEFT JOIN banks b ON b.id = t.bank_id
           LEFT JOIN categories c ON c.id = t.category_id ORDER BY t.occurred_at`,
        ).all<Record<string, unknown>>();
        const header = "occurred_at,bank,amount_rial,balance_rial,kind,category,note,is_internal,source";
        const lines = results.map((r) => [r.occurred_at, r.bank, r.amount_rial, r.balance_rial, r.kind, r.category, r.note, r.is_internal, r.source]
          .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
        return new Response("﻿" + [header, ...lines].join("\n"), {
          headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=hamara-transactions.csv" },
        });
      }

      return json({ ok: false, error: "not found" }, 404);
    }

    return json({ ok: false, error: "not found" }, 404);
  },
};
