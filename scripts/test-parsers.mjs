// Parser fixture tests — synthetic data only, no real numbers/amounts.
// Run: npm run test:parsers  (compiles src/parsers.ts to a temp dir first)
import { parseSms, parseSmsBulk, parseStatementCsv } from "../.test-build/parsers.js";

let failures = 0;
function check(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) console.log("ok  ", name);
  else { failures++; console.log("FAIL", name, "\n  got :", g, "\n  want:", w); }
}
const pick = (tx) => tx && ({
  bank: tx.bank, amountRial: tx.amountRial, balanceRial: tx.balanceRial ?? null,
  occurredAt: tx.occurredAt, kind: tx.kind ?? null,
});
const recv = new Date("2026-08-12T06:00:00Z"); // ~1405/05/21 Tehran

// 1. Tejarat deposit
check("tejarat deposit", pick(parseSms(`*بانک تجارت*
حساب: 123
واریز: 1,000,000 ریال
از طریق: خودپرداز
مانده: 2,500,000 ریال
1405/08/25
13:06`, recv)),
  { bank: "tejarat", amountRial: 1000000, balanceRial: 2500000, occurredAt: "2026-11-16T09:36:00.000Z", kind: "atm" });

// 2. Tejarat withdrawal
check("tejarat withdrawal", pick(parseSms(`*بانک تجارت*
حساب: 123
برداشت: 400,000 ریال
از طریق: شتاب
مانده: 2,100,000 ریال
1405/08/25
14:20`, recv)),
  { bank: "tejarat", amountRial: -400000, balanceRial: 2100000, occurredAt: "2026-11-16T10:50:00.000Z", kind: "shetab" });

// 3. Pasargad withdrawal (signed, no year)
check("pasargad withdrawal", pick(parseSms(`123.456
-300,000
05/21_09:10
مانده: 900,000`, recv)),
  { bank: "pasargad", amountRial: -300000, balanceRial: 900000, occurredAt: "2026-08-12T05:40:00.000Z", kind: null });

// 4. Pasargad deposit
check("pasargad deposit", pick(parseSms(`123.456
+500,000
05/21_10:00
مانده: 1,400,000`, recv)),
  { bank: "pasargad", amountRial: 500000, balanceRial: 1400000, occurredAt: "2026-08-12T06:30:00.000Z", kind: null });

// 5. Mellat short
check("mellat short", pick(parseSms(`حساب123
برداشت200,000
مانده800,000
05/08/07-05:40`, recv)),
  { bank: "mellat", amountRial: -200000, balanceRial: 800000, occurredAt: "2026-10-29T02:10:00.000Z", kind: null });

// 6. Mellat long (debt payment)
check("mellat long", pick(parseSms(`بانک ملت
مشتری گرامی، پرداخت بدهی ش.ق
بمبلغ 600,000 ریال از محل حساب بشماره 123 انجام شد.
1405/08/07 05:45`, recv)),
  { bank: "mellat", amountRial: -600000, balanceRial: null, occurredAt: "2026-10-29T02:15:00.000Z", kind: "debt_payment" });

// 7. Welcome message ignored
check("welcome ignored", parseSms(`دیما
کاربر عزیز خوش آمدید
1405/08/07 06:00`, recv), null);

// 8. Unknown text
check("unknown text", parseSms("سلام، این یه متن معمولیه", recv), null);

// 9. Statement CSV (Persian headers, debit/credit)
const csv = `تاریخ,شرح,بدهکار,بستانکار,مانده
1405/08/01,خرید,150000,,850000
1405/08/02,حقوق,,2000000,2850000`;
const rows = parseStatementCsv(csv, "pasargad");
check("csv rows", rows.map((r) => ({ a: r.amountRial, b: r.balanceRial, n: r.note })),
  [{ a: -150000, b: 850000, n: "خرید" }, { a: 2000000, b: 2850000, n: "حقوق" }]);

// 10. Bulk: three SMS in one message, back to back
const bulk = parseSmsBulk(`*بانک تجارت*
حساب: 123
برداشت: 100,000 ریال
از طریق: شتاب
مانده: 900,000 ریال
1405/08/25
10:00
123.456
-200,000
05/21_11:00
مانده: 700,000
حساب123
برداشت50,000
مانده650,000
05/08/07-12:00`, recv);
check("bulk count", bulk.length, 3);
check("bulk banks", bulk.map((t) => t.bank), ["tejarat", "pasargad", "mellat"]);
check("bulk amounts", bulk.map((t) => t.amountRial), [-100000, -200000, -50000]);

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall parser tests passed");
process.exit(failures ? 1 : 0);
