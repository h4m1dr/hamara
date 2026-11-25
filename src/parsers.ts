// Bank SMS / statement parsers — stubs with the verified templates.
// Full templates (redacted, no real numbers/amounts): docs/parsers.md
// Rules learned from real samples:
// - Tejarat: explicit برداشت/واریز + ریال, full Jalali date, time on its own line
// - Pasargad/Wepod: signed amount only (+/-), date MM/DD_HH:MM with NO year
//   (year comes from message receive date), no ریال word
// - Mellat short: برداشت<amount> glued, date YY/MM/DD-HH:MM (year without "14")
// - Mellat long: "پرداخت بدهی ... انجام شد" = withdrawal
// - Mellat welcome messages are NOT transactions — must be ignored
// - Amounts are Rial; display in Toman = /10

export type ParsedTransaction = {
  bank: "tejarat" | "pasargad" | "mellat";
  amountRial: number; // signed: + deposit, - withdrawal
  balanceRial?: number;
  occurredAt: string; // ISO, converted from Jalali
  kind?: string;
};

export function parseSms(_text: string, _receivedAt: Date): ParsedTransaction | null {
  // TODO Phase 1: implement per docs/parsers.md, test with fixtures
  return null;
}

export function parseStatementCsv(_csv: string, _bank: string): ParsedTransaction[] {
  // TODO Phase 1: Wepod CSV adapter first (needs a real header sample)
  return [];
}
