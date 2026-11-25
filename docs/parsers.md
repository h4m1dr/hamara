# Bank SMS templates for the parser — no real numbers or amounts

All account/card numbers, balances and real amounts are removed; only the structure is kept. Persian keywords below are literal bank SMS text the parser must match.

## 1. Tejarat
```
*بانک تجارت*
حساب: <account>
برداشت: <amount> ریال        (or واریز:)
از طریق: <channel>            (شتاب / خودپرداز / شعبه / پایا ...)
مانده: <balance> ریال
<1405/08/25>
<13:06>
```
- The words for withdrawal/deposit and "Rial" are explicit. Full Jalali date + time on its own line.

## 2. Pasargad / Wepod
```
<account.with.dots>
-<amount>                     (withdrawal; deposit uses +)
<MM/DD_HH:MM>                 (no year)
مانده: <balance>
```
- No withdrawal/deposit word and no "Rial"; only the + / - sign.
- The date has no year; the year must come from the message receive date.

## 3. Mellat
Short template:
```
حساب<account>
برداشت<amount>
مانده<balance>
<YY/MM/DD-HH:MM>              (year without the "14" prefix)
```
Long template (debt payment = withdrawal):
```
بانک ملت
مشتری گرامی، پرداخت بدهی ش.ق
بمبلغ <amount> ریال از محل حساب بشماره <account> انجام شد.
<1405/08/07 05:45>
```
Non-transaction messages the parser must ignore:
- Dima welcome ("… عزیز خوش آمدید") + date
- Mellat mobile-banking welcome + date

## Differences the parser must handle
- Three date formats: full Jalali (Tejarat), month/day_time without year (Pasargad), short year with dash (Mellat).
- Transaction kind: explicit word (Tejarat/Mellat short), + / - sign (Pasargad), the "debt payment … done" sentence (Mellat long = withdrawal).
- Unit: "Rial" appears only in Tejarat and Mellat long; Pasargad and Mellat short omit it — default Rial, display Toman = /10.
