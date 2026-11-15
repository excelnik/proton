// Idempotent SQLite schema repair for both new and existing user databases.
// Keep this after the CREATE TABLE statements in src/db/index.js.
function ensureColumn(db, table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info("${table}")`).all()
    .some(item => item.name === column)
  if (!exists) db.exec(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`)
}

function runMigrations(db) {
  const migrations = [
    ['Transactions', 'value_date', 'TEXT'],
    ['Transactions', 'import_id', 'TEXT'],
    ['Transactions', 'settles_credit_card_id', 'INTEGER REFERENCES Accounts(id)'],
    ['Transactions', 'parent_id', 'INTEGER REFERENCES Transactions(id)'],
    ['Transactions', 'offset_group_id', 'INTEGER'],
    ['Transactions', 'insurance_id', 'INTEGER REFERENCES Insurance_Policies(id)'],
    ['Transactions', 'liability_id', 'INTEGER REFERENCES Liabilities(id)'],
    ['Transactions', 'recurring_id', 'INTEGER REFERENCES Recurring_Templates(id)'],
    ['Transactions', 'savings_goal_id', 'INTEGER REFERENCES Savings_Goals(id)'],
    ['Automation_Rules', 'account_id', 'INTEGER REFERENCES Accounts(id)'],
    ['Automation_Rules', 'min_amount', 'REAL'],
    ['Automation_Rules', 'max_amount', 'REAL'],
    ['Automation_Rules', 'valid_from', 'TEXT'],
    ['Automation_Rules', 'valid_to', 'TEXT'],
    ['Automation_Rules', 'enabled', 'INTEGER NOT NULL DEFAULT 1'],
    ['Recurring_Templates', 'season_months', 'TEXT'],
    ['Recurring_Templates', 'minimum_commitment', 'INTEGER NOT NULL DEFAULT 1'],
    ['Accounts', 'billing_day', 'INTEGER'],
    ['Accounts', 'settlement_account_id', 'INTEGER REFERENCES Accounts(id)'],
    ['Accounts', 'current_balance', 'REAL'],
    ['Accounts', 'balance_updated_at', 'TEXT'],
    ['Assets', 'exchange', 'TEXT'],
    ['Assets', 'last_api_price', 'REAL'],
    ['Assets', 'price_currency', "TEXT DEFAULT 'ILS'"],
    ['Assets', 'price_override', 'REAL'],
    ['Assets', 'price_updated_at', 'TEXT'],
    ['Assets', 'purchase_price', 'REAL'],
    ['Assets', 'purchase_date', 'TEXT'],
  ]

  const apply = db.transaction(() => {
    for (const [table, column, definition] of migrations) {
      ensureColumn(db, table, column, definition)
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS Schema_Migrations (
        name TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS Merchant_Registry (
        normalized_name TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'unrecognized' CHECK(status IN ('known','unrecognized')),
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    db.exec(`
      CREATE TABLE IF NOT EXISTS Informal_Debt_Payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        debt_id INTEGER NOT NULL REFERENCES Informal_Debts(id) ON DELETE CASCADE,
        amount REAL NOT NULL CHECK(amount > 0),
        payment_date TEXT NOT NULL,
        transaction_id INTEGER REFERENCES Transactions(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_informal_debt_payment_transaction
        ON Informal_Debt_Payments(transaction_id)
        WHERE transaction_id IS NOT NULL;
    `)
    db.prepare(`
      INSERT OR IGNORE INTO Schema_Migrations (name) VALUES (?)
    `).run('repair_missing_columns_v1')
    db.prepare(`
      INSERT OR IGNORE INTO Schema_Migrations (name) VALUES (?)
    `).run('merchant_registry_v1')
  })

  apply()
}

module.exports = { runMigrations }
