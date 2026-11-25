// Bank SMS / statement parsers — Phase 1 implementation.
// Full templates (redacted, no real numbers/amounts): docs/parsers.md
// Rules learned from real samples:
// - Tejarat: explicit برداشت/واریز + ریال, full Jalali date, time on its own line
// - Pasargad/Wepod: signed amount only (+/-), date MM/DD_HH:MM with NO year
//   (year comes from message receive date), no ریال word
// - Mellat short: برداشت<amount> glued, date YY/MM/DD-HH:MM (year without "14")
// - Mellat long: "پرداخت بدهی ... انجام شد" = withdrawal
// - Mellat welcome messages are NOT transactions — must be ignored
// - Amounts are Rial; display in Toman = /10
// - SMS times are Tehran local (UTC+03:30, no DST); occurredAt is stored as UTC ISO.

export type ParsedTransaction = {
  bank: "tejarat" | "pasargad" | "mellat";
  amountRial: number; // signed: + deposit, - withdrawal
  balanceRial?: number;
  occurredAt: string; // ISO, converted from Jalali
  kind?: string;
  note?: string; // statement description, shown on the list card
};

// ---------- helpers ----------

const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const AR_DIGITS = "٠١٢٣٤٥٦٧٨٩";

function normalizeDigits(text: string): string {
  return text.replace(/[۰-۹٠-٩]/g, (ch) => {
    const fa = FA_DIGITS.indexOf(ch);
    if (fa >= 0) return String(fa);
    return String(AR_DIGITS.indexOf(ch));
  });
}

function parseAmount(raw: string): number {
  return Number(raw.replace(/[,٬\s]/g, ""));
}

// Jalali <-> Gregorian conversion, anchored on 1400/01/01 = 2021-03-21.
// Leap years use the standard 33-year cycle residues (accurate 1200-1500).

function div(a: number, b: number): number {
  return Math.trunc(a / b);
}
function mod(a: number, b: number): number {
  return a - Math.trunc(a / b) * b;
}

function jalaliToJdn(jy: number, jm: number, jd: number): number {
  // Julian day number of the Jalali date.
  // Anchor: 1400/01/01 Jalali = 2021-03-21 Gregorian.
  const anchorJdn = gregorianToJdn(2021, 3, 21);
  let days = 0;
  // Whole years from 1400 to jy-1 (or backwards).
  const step = jy >= 1400 ? 1 : -1;
  for (let y = 1400; y !== jy; y += step) {
    const year = step === 1 ? y : y - 1;
    days += step * (isJalaliLeap(year) ? 366 : 365);
  }
  const monthDays = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  for (let m = 1; m < jm; m++) days += monthDays[m - 1];
  days += jd - 1;
  return anchorJdn + days;
}

function isJalaliLeap(jy: number): boolean {
  // Leap if the year length computed from the breaks algorithm is 366.
  // Use the standard 33-year cycle residues, accurate for 1200-1500.
  const r = mod(jy, 33);
  return [1, 5, 9, 13, 17, 22, 26, 30].includes(r);
}

function gregorianToJdn(y: number, m: number, d: number): number {
  const a = div(14 - m, 12);
  const y2 = y + 4800 - a;
  const m2 = m + 12 * a - 3;
  return (
    d + div(153 * m2 + 2, 5) + 365 * y2 + div(y2, 4) - div(y2, 100) +
    div(y2, 400) - 32045
  );
}

function jdnToGregorian(jdn: number): { y: number; m: number; d: number } {
  let a = jdn + 32044;
  const b = div(4 * a + 3, 146097);
  const c = a - div(146097 * b, 4);
  const d2 = div(4 * c + 3, 1461);
  const e = c - div(1461 * d2, 4);
  const m2 = div(5 * e + 2, 153);
  const day = e - div(153 * m2 + 2, 5) + 1;
  const month = m2 + 3 - 12 * div(m2, 10);
  const year = 100 * b + d2 - 4800 + div(m2, 10);
  return { y: year, m: month, d: day };
}

function jalaliToGregorian(jy: number, jm: number, jd: number) {
  return jdnToGregorian(jalaliToJdn(jy, jm, jd));
}

function gregorianToJalali(gy: number, gm: number, gd: number) {
  const jdn = gregorianToJdn(gy, gm, gd);
  // Anchor 1400/01/01 = 2021-03-21.
  let days = jdn - gregorianToJdn(2021, 3, 21);
  let jy = 1400;
  while (days >= (isJalaliLeap(jy) ? 366 : 365)) {
    days -= isJalaliLeap(jy) ? 366 : 365;
    jy++;
  }
  while (days < 0) {
    jy--;
    days += isJalaliLeap(jy) ? 366 : 365;
  }
  const monthDays = [31, 31, 31, 31, 31, 31, 30, 30, 30, 30, 30, 29];
  let jm = 1;
  while (days >= monthDays[jm - 1] + (jm === 12 && isJalaliLeap(jy) ? 1 : 0)) {
    days -= monthDays[jm - 1] + (jm === 12 && isJalaliLeap(jy) ? 1 : 0);
    jm++;
  }
  return { jy, jm, jd: days + 1 };
}

/** Jalali date + Tehran wall-clock time -> UTC ISO string. */
function toIsoUtc(jy: number, jm: number, jd: number, hh: number, mm: number): string {
  const g = jalaliToGregorian(jy, jm, jd);
  const utcMs =
    Date.UTC(g.y, g.m - 1, g.d, hh, mm, 0) - 3.5 * 60 * 60 * 1000;
  return new Date(utcMs).toISOString();
}

function channelKind(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (t.includes("پایا")) return "paya";
  if (t.includes("کارت به کارت")) return "card_to_card";
  if (t.includes("خودپرداز")) return "atm";
  if (t.includes("شتاب")) return "shetab";
  if (t.includes("شعبه")) return "branch";
  if (t.includes("خرید")) return "pos";
  return t || undefined;
}

// ---------- parsers ----------

export function parseSms(text: string, receivedAt: Date): ParsedTransaction | null {
  const t = normalizeDigits(text);

  // Welcome / non-transaction messages (Dima, Mellat mobile banking).
  if (t.includes("خوش آمدید") || t.includes("خوش‌آمدید")) return null;

  // --- Tejarat ---
  const tej = t.match(/(برداشت|واریز)\s*:\s*([\d,٬]+)\s*ریال/);
  if (tej) {
    const date = t.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
    const time = t.match(/(?:^|\n)\s*(\d{1,2}):(\d{2})\s*(?:\n|$)/) ??
      t.match(/(\d{1,2}):(\d{2})/);
    if (!date || !time) return null;
    const balance = t.match(/مانده\s*:\s*([\d,٬]+)\s*ریال/);
    const channel = t.match(/از طریق\s*:\s*(.+)/);
    const amount = parseAmount(tej[2]);
    return {
      bank: "tejarat",
      amountRial: tej[1] === "برداشت" ? -amount : amount,
      balanceRial: balance ? parseAmount(balance[1]) : undefined,
      occurredAt: toIsoUtc(
        Number(date[1]), Number(date[2]), Number(date[3]),
        Number(time[1]), Number(time[2]),
      ),
      kind: channelKind(channel?.[1]),
    };
  }

  // --- Mellat long (debt payment = withdrawal) ---
  if (t.includes("پرداخت بدهی") && t.includes("انجام شد")) {
    const amt = t.match(/بمبلغ\s*([\d,٬]+)\s*ریال/);
    const dt = t.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/);
    if (!amt || !dt) return null;
    return {
      bank: "mellat",
      amountRial: -parseAmount(amt[1]),
      occurredAt: toIsoUtc(
        Number(dt[1]), Number(dt[2]), Number(dt[3]),
        Number(dt[4]), Number(dt[5]),
      ),
      kind: "debt_payment",
    };
  }

  // --- Mellat short ---
  const mel = t.match(/(برداشت|واریز)\s*([\d,٬]+)/);
  if (mel && t.includes("حساب")) {
    const dt = t.match(/(\d{2})\/(\d{1,2})\/(\d{1,2})-(\d{1,2}):(\d{2})/);
    if (!dt) return null;
    const balance = t.match(/مانده\s*([\d,٬]+)/);
    const amount = parseAmount(mel[2]);
    return {
      bank: "mellat",
      amountRial: mel[1] === "برداشت" ? -amount : amount,
      balanceRial: balance ? parseAmount(balance[1]) : undefined,
      occurredAt: toIsoUtc(
        1400 + Number(dt[1]), Number(dt[2]), Number(dt[3]),
        Number(dt[4]), Number(dt[5]),
      ),
    };
  }

  // --- Pasargad / Wepod ---
  const pas = t.match(/([+-])([\d,٬]+)\s*\n\s*(\d{1,2})\/(\d{1,2})_(\d{1,2}):(\d{2})/);
  if (pas) {
    const balance = t.match(/مانده\s*:\s*([\d,٬]+)/);
    // No year in the SMS: take the Jalali year of the receive date (Tehran).
    const recvTehran = new Date(receivedAt.getTime() + 3.5 * 60 * 60 * 1000);
    const recvJ = gregorianToJalali(
      recvTehran.getUTCFullYear(), recvTehran.getUTCMonth() + 1, recvTehran.getUTCDate(),
    );
    let jy = recvJ.jy;
    const jm = Number(pas[3]);
    const jd = Number(pas[4]);
    // If the SMS date would be in the future relative to receipt, it belongs
    // to the previous Jalali year (e.g. received in early Farvardin).
    if (jm > recvJ.jm || (jm === recvJ.jm && jd > recvJ.jd + 1)) jy -= 1;
    const amount = parseAmount(pas[2]);
    return {
      bank: "pasargad",
      amountRial: pas[1] === "-" ? -amount : amount,
      balanceRial: balance ? parseAmount(balance[1]) : undefined,
      occurredAt: toIsoUtc(jy, jm, jd, Number(pas[5]), Number(pas[6])),
    };
  }

  return null;
}

// ---------- statement CSV ----------
// Generic adapter: detects common Persian/English column headers.
// The exact Wepod export headers are still unconfirmed (no sample yet);
// when a real Wepod file arrives, verify its headers against the aliases
// below and extend them if needed.

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["تاریخ", "تاریختراکنش", "زمان", "date", "datetime", "transactiondate"],
  amount: ["مبلغ", "مبلغتراکنش", "amount", "transactionamount"],
  debit: ["بدهکار", "برداشت", "بده", "debit", "withdrawal"],
  credit: ["بستانکار", "واریز", "بست", "credit", "deposit"],
  balance: ["مانده", "ماندهحساب", "balance"],
  note: ["شرح", "شرحتراکنش", "توضیح", "توضیحات", "description", "note"],
  kind: ["نوع", "نوعتراکنش", "type", "kind"],
};

function normalizeHeader(raw: string): string {
  return normalizeDigits(raw)
    .replace(/[\s‌_‌-]/g, "")
    .toLowerCase();
}

function splitCsvLine(line: string, delim: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delim && !inQuotes) {
      cells.push(cur); cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

function parseJalaliDateTime(raw: string): string | null {
  const t = normalizeDigits(raw.trim());
  const m = t.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ _T]+(\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  return toIsoUtc(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
}

export function parseStatementCsv(
  csv: string,
  bank: ParsedTransaction["bank"],
): ParsedTransaction[] {
  const lines = csv.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const delim = lines[0].includes(";") ? ";" : ",";
  const headers = splitCsvLine(lines[0], delim).map(normalizeHeader);
  const col: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = headers.findIndex((h) => aliases.includes(h));
    if (idx >= 0) col[field] = idx;
  }
  if (col.date === undefined || (col.amount === undefined && col.debit === undefined && col.credit === undefined)) {
    return [];
  }

  const out: ParsedTransaction[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line, delim);
    const occurredAt = parseJalaliDateTime(cells[col.date] ?? "");
    if (!occurredAt) continue;

    let amountRial: number;
    if (col.debit !== undefined || col.credit !== undefined) {
      const debit = col.debit !== undefined ? parseAmount(cells[col.debit] || "0") : 0;
      const credit = col.credit !== undefined ? parseAmount(cells[col.credit] || "0") : 0;
      amountRial = credit - debit;
    } else {
      amountRial = parseAmount(cells[col.amount] || "0");
      const kindRaw = col.kind !== undefined ? cells[col.kind] : "";
      if (amountRial > 0 && /(برداشت|بدهکار|withdrawal|debit)/i.test(kindRaw)) {
        amountRial = -amountRial;
      }
    }
    if (!amountRial) continue;

    out.push({
      bank,
      amountRial,
      balanceRial: col.balance !== undefined && cells[col.balance] ? parseAmount(cells[col.balance]) : undefined,
      occurredAt,
      kind: col.kind !== undefined ? channelKind(cells[col.kind]) : undefined,
      note: col.note !== undefined && cells[col.note] ? cells[col.note] : undefined,
    });
  }
  return out;
}
