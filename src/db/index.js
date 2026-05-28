const Database = require('better-sqlite3')
const path = require('path')
const fs = require('fs')
const os = require('os')

// נתיב ה-DB
const DB_DIR = process.env.PROTON_DB_PATH
  ?? path.join(os.homedir(), 'AppData', 'Roaming', 'proton')

if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}

const DB_PATH = path.join(DB_DIR, 'proton.db')
const db = new Database(DB_PATH)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
// מיגרציה — הוספת value_date אם לא קיים
try {
  db.exec('ALTER TABLE Transactions ADD COLUMN value_date TEXT')
} catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS Accounts (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT    NOT NULL,
    type               TEXT    NOT NULL CHECK(type IN ('Bank','Credit_Card','Cash')),
    opening_balance    REAL    NOT NULL DEFAULT 0,
    is_active          INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS Categories (
    id                 INTEGER PRIMARY KEY AUTOINCREMENT,
    name               TEXT    NOT NULL,
    parent_id          INTEGER REFERENCES Categories(id),
    type               TEXT    NOT NULL CHECK(type IN ('Income','Expense','Savings')),
    icon               TEXT,
    color              TEXT,
    is_active          INTEGER NOT NULL DEFAULT 1,
    is_system_category INTEGER NOT NULL DEFAULT 0,
    sort_order         INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS Transactions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_date    TEXT    NOT NULL,
    amount              REAL    NOT NULL,
    transaction_type    TEXT    NOT NULL CHECK(transaction_type IN ('Income','Expense','Transfer','Savings')),
    business_entity     TEXT,
    description         TEXT,
    category_id         INTEGER REFERENCES Categories(id),
    account_id          INTEGER NOT NULL REFERENCES Accounts(id),
    is_budgetary        INTEGER NOT NULL DEFAULT 1,
    is_maaser_obligated INTEGER NOT NULL DEFAULT 0,
    tags                TEXT,
    source              TEXT    NOT NULL DEFAULT 'manual',
    created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
    value_date          TEXT,
    liability_id        INTEGER REFERENCES Liabilities(id),
    recurring_id        INTEGER REFERENCES Recurring_Templates(id),
    parent_id           INTEGER REFERENCES Transactions(id),
    offset_group_id     INTEGER,
    insurance_id        INTEGER REFERENCES Insurance_Policies(id)
  );

  CREATE TABLE IF NOT EXISTS Budget_Goals (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id    INTEGER NOT NULL REFERENCES Categories(id),
    budget_period  TEXT    NOT NULL,
    planned_amount REAL    NOT NULL DEFAULT 0,
    UNIQUE(category_id, budget_period)
  );

  CREATE TABLE IF NOT EXISTS Automation_Rules (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    original_string TEXT    NOT NULL,
    cleaned_name    TEXT    NOT NULL,
    category_id     INTEGER REFERENCES Categories(id),
    match_type      TEXT    NOT NULL DEFAULT 'contains',
    priority        INTEGER NOT NULL DEFAULT 0,
    use_count       INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS Liabilities (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    total_amount        REAL    NOT NULL,
    interest_rate       REAL    NOT NULL DEFAULT 0,
    start_date          TEXT    NOT NULL,
    first_payment_date  TEXT    NOT NULL,
    duration_months     INTEGER NOT NULL,
    account_id          INTEGER NOT NULL REFERENCES Accounts(id),
    grace_period_months INTEGER NOT NULL DEFAULT 0,
    grace_type          TEXT    NOT NULL DEFAULT 'none',
    is_active           INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS Insurance_Policies (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    name           TEXT    NOT NULL,
    provider_name  TEXT    NOT NULL DEFAULT '',
    premium_amount REAL    NOT NULL,
    payment_type   TEXT    NOT NULL DEFAULT 'monthly',
    renewal_date   TEXT    NOT NULL,
    category_id    INTEGER REFERENCES Categories(id),
    recurring_id   INTEGER,
    is_active      INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS Savings_Goals (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    target_amount        REAL    NOT NULL,
    target_date          TEXT    NOT NULL,
    starting_balance     REAL    NOT NULL DEFAULT 0,
    annual_interest_rate REAL    NOT NULL DEFAULT 0,
    account_id           INTEGER REFERENCES Accounts(id),
    is_active            INTEGER NOT NULL DEFAULT 1,
    savings_goal_id     INTEGER REFERENCES Savings_Goals(id)
  );

    CREATE TABLE IF NOT EXISTS Assets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    type          TEXT    NOT NULL DEFAULT 'Other',
    current_value REAL    NOT NULL DEFAULT 0,
    quantity      REAL    NOT NULL DEFAULT 1,
    ticker_symbol TEXT,
    last_updated  TEXT,
    is_active     INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS Informal_Debts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    amount     REAL    NOT NULL,
    direction  TEXT    NOT NULL DEFAULT 'borrowed',
    due_date   TEXT,
    notes      TEXT,
    is_active  INTEGER NOT NULL DEFAULT 1
  );

    CREATE TABLE IF NOT EXISTS Recurring_Templates (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    type                TEXT    NOT NULL DEFAULT 'recurring',
    amount              REAL    NOT NULL DEFAULT 0,
    frequency           TEXT    NOT NULL DEFAULT 'monthly',
    charge_day          INTEGER NOT NULL DEFAULT 1,
    first_charge_date   TEXT,
    account_id          INTEGER REFERENCES Accounts(id),
    category_id         INTEGER REFERENCES Categories(id),
    insurance_id        INTEGER,
    is_estimated        INTEGER NOT NULL DEFAULT 0,
    is_budgetary        INTEGER NOT NULL DEFAULT 1,
    is_maaser_obligated INTEGER NOT NULL DEFAULT 0,
    num_installments    INTEGER,
    installments_paid   INTEGER NOT NULL DEFAULT 0,
    total_amount        REAL,
    template_payload    TEXT,
    notes               TEXT,
    is_active           INTEGER NOT NULL DEFAULT 1
  );
`)

// קטגוריות ברירת מחדל
const count = db.prepare('SELECT COUNT(*) as c FROM Categories').get()
if (count.c === 0) {
  db.exec(`
    INSERT INTO Categories (name, type, icon, color, is_system_category, sort_order) VALUES
      ('מזון ושתייה',  'Expense', '🛒', '#10B981', 0, 1),
      ('תחבורה',       'Expense', '🚗', '#F59E0B', 0, 2),
      ('מגורים',       'Expense', '🏠', '#2563EB', 0, 3),
      ('בריאות',       'Expense', '💊', '#E11D48', 0, 4),
      ('ביטוחים',      'Expense', '🛡️', '#8B5CF6', 0, 5),
      ('חינוך',        'Expense', '📚', '#0891B2', 0, 6),
      ('בידור ופנאי',  'Expense', '🎭', '#EC4899', 0, 7),
      ('תרומות וצדקה', 'Expense', '🕍', '#6366F1', 1, 9),
      ('תיקוני מערכת', 'Expense', '⚙️', '#94A3B8', 1, 12),
      ('משכורת',       'Income',  '💼', '#10B981', 0, 1),
      ('הכנסה נוספת',  'Income',  '💵', '#10B981', 0, 2),
      ('החזרים',       'Income',  '↩️', '#10B981', 0, 3),
      ('מתנות',        'Income',  '🎁', '#F59E0B', 0, 4),
      ('קרן פנסיה',    'Savings', '🏛️', '#0D9488', 0, 13),
      ('קרן השתלמות',  'Savings', '📈', '#0D9488', 0, 14),
      ('פיקדון',       'Savings', '🏦', '#0D9488', 0, 15),
      ('תיק השקעות',  'Savings', '💰', '#0D9488', 0, 16),
      ('קרן חירום',    'Savings', '🛟', '#0D9488', 0, 17);
  `)
}

function getDateColumn() {
  try {
    const row = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string='date_calc_mode' AND match_type='setting'"
    ).get()
    return row?.cleaned_name === 'value_date' ? 'value_date' : 'transaction_date'
  } catch { return 'transaction_date' }
}

module.exports = db
module.exports.getDateColumn = getDateColumn