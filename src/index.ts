// hamara — Cloudflare Worker: Telegram bot + Mini App + API (Phase 1 core)
// Bot: /start opens the Mini App; SMS text and statement CSV files are
// imported with confirmation replies. Real work (list, categories, charts,
// export) happens in the Mini App through the API below.
// Access: single-user allowlist (ALLOWED_TELEGRAM_ID). API calls from the
// Mini App are authenticated with Telegram initData HMAC.

import { parseSms, parseStatementCsv, type ParsedTransaction } from "./parsers";

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
        const tx = parseSms(text, new Date());
        if (!tx) {
          await tgSend(env, chatId, "این متن رو به‌عنوان پیامک بانک نشناختم. پیامک تجارت، پاسارگاد/ویپاد یا ملت رو بفرست، یا فایل CSV صورتحساب رو.");
          return json({ ok: true });
        }
        const result = await saveTransaction(env, tx, "sms");
        const bankFa = { tejarat: "تجارت", pasargad: "پاسارگاد/ویپاد", mellat: "ملت" }[tx.bank];
        const dirFa = tx.amountRial < 0 ? "برداشت" : "واریز";
        await tgSend(env, chatId, result === "added"
          ? `ثبت شد: ${dirFa} ${faNum(tx.amountRial)} تومان — ${bankFa}` +
            (tx.balanceRial !== undefined ? `\nمانده: ${faNum(tx.balanceRial)} تومان` : "")
          : "این تراکنش قبلاً ثبت شده بود، دوباره اضافه نشد.");
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

      const txMatch = url.pathname.match(/^\/api\/transactions\/(\d+)$/);
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

// ---------- Mini App page (functional Phase 1 UI; Wepod polish is Phase 2) ----------

const APP_HTML = `<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>hamara</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
  :root{--bg:#f5f6f8;--card:#fff;--text:#111;--muted:#888;--line:#e5e7eb;--accent:#2563eb}
  body.dark{--bg:#0f1115;--card:#1a1d24;--text:#eee;--muted:#9aa;--line:#2a2e38}
  body{font-family:system-ui,sans-serif;background:var(--bg);color:var(--text);margin:0;padding:12px}
  .chips{display:flex;gap:8px;overflow-x:auto;padding:4px 0 12px}
  .chip{border:1px solid var(--line);background:var(--card);color:var(--text);border-radius:999px;padding:6px 14px;white-space:nowrap;cursor:pointer}
  .chip.on{background:var(--accent);color:#fff;border-color:var(--accent)}
  .card{background:var(--card);border:1px solid var(--line);border-right:4px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0}
  .row{display:flex;justify-content:space-between;align-items:center}
  .amt{font-weight:700}.neg{color:#dc2626}.pos{color:#16a34a}
  .muted{color:var(--muted);font-size:12px}
  .tag{font-size:11px;border-radius:6px;padding:2px 8px;color:#fff}
  select,button,input{background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:8px;padding:6px}
  canvas{max-width:100%}
</style></head><body>
<div class="chips" id="chips"></div>
<div class="row"><select id="fCat"></select><select id="fKind"></select>
<button id="themeBtn">تم</button><button id="csvBtn">خروجی CSV</button></div>
<canvas id="donut" width="320" height="320"></canvas>
<canvas id="bars" width="360" height="200"></canvas>
<div id="list"></div>
<script>
const tg = window.Telegram.WebApp; tg.ready();
const H = {'x-telegram-init-data': tg.initData || ''};
const $ = (id) => document.getElementById(id);
let bank = '', cats = [];
const toman = (r) => Math.abs(Math.round(r/10)).toLocaleString('fa-IR');
async function api(path, opts) { const r = await fetch(path, {headers:{...H,'content-type':'application/json'}, ...opts}); return r.json(); }
async function load() {
  const [b, c, s] = await Promise.all([api('/api/banks'), api('/api/categories'), api('/api/settings')]);
  cats = c.items || [];
  if ((s.items||[]).find(x=>x.key==='theme')?.value === 'dark') document.body.classList.add('dark');
  $('chips').innerHTML = ['<button class="chip on" data-b="">همه</button>', ...(b.items||[]).map(x=>'<button class="chip" data-b="'+x.id+'">'+x.name+'</button>')].join('');
  document.querySelectorAll('.chip').forEach(el=>el.onclick=()=>{bank=el.dataset.b;document.querySelectorAll('.chip').forEach(e=>e.classList.toggle('on',e===el));loadTx();});
  $('fCat').innerHTML = '<option value="">همه دسته‌ها</option><option value="none">بدون دسته</option>' + cats.map(x=>'<option value="'+x.id+'">'+x.name+'</option>').join('');
  const kinds = [...new Set((await api('/api/transactions?limit=500')).items.map(x=>x.kind).filter(Boolean))];
  $('fKind').innerHTML = '<option value="">همه نوع‌ها</option>' + kinds.map(k=>'<option>'+k+'</option>').join('');
  loadTx(); loadStats();
}
async function loadTx() {
  const q = new URLSearchParams({bank, category:$('fCat').value, kind:$('fKind').value});
  const d = await api('/api/transactions?' + q);
  $('list').innerHTML = (d.items||[]).map(t => {
    const color = t.category_color || '#e5e7eb';
    const when = new Date(t.occurred_at).toLocaleString('fa-IR',{timeZone:'Asia/Tehran'});
    return '<div class="card" style="border-right-color:'+color+'"><div class="row"><span>'+(t.bank_name||'')+(t.is_internal?' · انتقال داخلی':'')+'</span><span class="amt '+(t.amount_rial<0?'neg':'pos')+'">'+(t.amount_rial<0?'-':'+')+toman(t.amount_rial)+' تومان</span></div>'
      + '<div class="row"><span class="muted">'+when+'</span>' + (t.category_name?'<span class="tag" style="background:'+color+'">'+t.category_name+'</span>':'') + '</div>'
      + (t.note?'<div>'+t.note+'</div>':'')
      + '<div class="row"><select onchange="setCat('+t.id+',this.value)"><option value="">دسته…</option>'+cats.map(c=>'<option value="'+c.id+'"'+(c.id===t.category_id?' selected':'')+'>'+c.name+'</option>').join('')+'</select>'
      + '<button onclick="setNote('+t.id+')">یادداشت</button></div></div>';
  }).join('') || '<p class="muted">تراکنشی نیست.</p>';
}
async function setCat(id, v) { await api('/api/transactions/'+id, {method:'PATCH', body: JSON.stringify({category_id: v?Number(v):null})}); loadTx(); loadStats(); }
async function setNote(id) { const n = prompt('یادداشت:'); if (n===null) return; await api('/api/transactions/'+id, {method:'PATCH', body: JSON.stringify({note: n})}); loadTx(); }
async function loadStats() {
  const s = await api('/api/stats');
  drawDonut(s.donut||[], s.internal_total||0); drawBars(s.monthly||[]);
}
function drawDonut(rows, internal) {
  const cv = $('donut'), ctx = cv.getContext('2d'); ctx.clearRect(0,0,320,320);
  const data = rows.map(r=>({v:r.total,c:r.color,n:r.name}));
  if (internal>0) data.push({v:internal,c:'#94a3b8',n:'انتقال داخلی'});
  const total = data.reduce((a,d)=>a+d.v,0); if (!total) { ctx.fillText('داده‌ای نیست',120,160); return; }
  let a = -Math.PI/2;
  for (const d of data) { const sw = d.v/total*Math.PI*2; ctx.beginPath(); ctx.moveTo(160,160); ctx.arc(160,160,140,a,a+sw); ctx.fillStyle=d.c; ctx.fill(); a+=sw; }
  ctx.globalCompositeOperation='destination-out'; ctx.beginPath(); ctx.arc(160,160,80,0,Math.PI*2); ctx.fill(); ctx.globalCompositeOperation='source-over';
  ctx.fillStyle=getComputedStyle(document.body).color; ctx.font='12px sans-serif';
  data.forEach((d,i)=>ctx.fillText(d.n+' '+toman(d.v), 10, 20+i*16));
}
function drawBars(rows) {
  const cv = $('bars'), ctx = cv.getContext('2d'); ctx.clearRect(0,0,360,200);
  if (!rows.length) return;
  const max = Math.max(...rows.flatMap(r=>[r.income,r.expense]));
  const w = 360/rows.length;
  rows.forEach((r,i)=>{ const x=i*w+4; ctx.fillStyle='#16a34a'; ctx.fillRect(x,180-(r.income/max*160),w/2-4,r.income/max*160); ctx.fillStyle='#dc2626'; ctx.fillRect(x+w/2,180-(r.expense/max*160),w/2-4,r.expense/max*160); ctx.fillStyle=getComputedStyle(document.body).color; ctx.font='9px sans-serif'; ctx.fillText(r.month,x,195); });
}
$('fCat').onchange = loadTx; $('fKind').onchange = loadTx;
$('themeBtn').onclick = async () => { const dark = document.body.classList.toggle('dark'); await api('/api/settings',{method:'POST',body:JSON.stringify({theme:dark?'dark':'light'})}); };
$('csvBtn').onclick = async () => { const r = await fetch('/api/export.csv',{headers:H}); const b = await r.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download='hamara-transactions.csv'; a.click(); };
load();
</script></body></html>`;
