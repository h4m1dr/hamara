-- hamara — D1 schema (single user for now)

CREATE TABLE IF NOT EXISTS banks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- e.g. Pasargad/Wepod, Tejarat, Melli, Mellat
  account_ref TEXT,                -- last digits / label only, never full secrets in git
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- user category, e.g. food, clothes, shopping
  color TEXT NOT NULL DEFAULT '#888888',
  icon TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bank_id INTEGER REFERENCES banks(id),
  category_id INTEGER REFERENCES categories(id),
  amount_rial INTEGER NOT NULL,    -- signed: + deposit, - withdrawal
  balance_rial INTEGER,
  kind TEXT,                       -- transfer channel: paya / card_to_card / pos / pol / ...
  note TEXT,                       -- shown on the list card itself
  is_internal INTEGER NOT NULL DEFAULT 0,  -- transfer between own banks: excluded from income/expense totals
  occurred_at TEXT NOT NULL,       -- ISO datetime (converted from Jalali at parse time)
  source TEXT NOT NULL,            -- sms | statement_csv | statement_pdf | manual
  dedup_hash TEXT UNIQUE,          -- composite hash to skip duplicates on re-import
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,            -- theme (light/dark), ...
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  filename TEXT,
  rows_added INTEGER NOT NULL DEFAULT 0,
  rows_skipped INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
