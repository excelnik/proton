const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { runMigrations } = require('../src/db/migrations')
const {
  registerMerchant, approveMerchant, setMerchantStatus, listMerchants, getMerchantStatus,
} = require('../src/lib/merchantRegistry')

function makeDb() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE Accounts (id INTEGER PRIMARY KEY);
    CREATE TABLE Transactions (id INTEGER PRIMARY KEY);
    CREATE TABLE Assets (id INTEGER PRIMARY KEY);
    CREATE TABLE Automation_Rules (id INTEGER PRIMARY KEY, original_string TEXT, cleaned_name TEXT, category_id INTEGER, match_type TEXT, priority INTEGER, use_count INTEGER);
    CREATE TABLE Insurance_Policies (id INTEGER PRIMARY KEY);
    CREATE TABLE Liabilities (id INTEGER PRIMARY KEY);
    CREATE TABLE Recurring_Templates (id INTEGER PRIMARY KEY);
    CREATE TABLE Savings_Goals (id INTEGER PRIMARY KEY);
  `)
  runMigrations(db)
  return db
}

test('registers unknown merchants once and preserves approval by normalized name', () => {
  const db = makeDb()
  try {
    const first = registerMerchant(db, 'ACME בע״מ')
    const second = registerMerchant(db, 'Acme')
    assert.equal(first.status, 'unrecognized')
    assert.equal(second.normalized_name, first.normalized_name)
    assert.equal(listMerchants(db).length, 1)
    assert.equal(getMerchantStatus(db, 'acme'), 'unrecognized')
    approveMerchant(db, 'Acme')
    assert.equal(getMerchantStatus(db, 'ACME בע״מ'), 'known')
  } finally { db.close() }
})

test('allows moving a merchant back to unrecognized without deleting its history', () => {
  const db = makeDb()
  try {
    registerMerchant(db, 'Example Store')
    const row = listMerchants(db)[0]
    approveMerchant(db, 'Example Store')
    setMerchantStatus(db, row.normalized_name, 'unrecognized')
    assert.equal(getMerchantStatus(db, 'Example Store'), 'unrecognized')
    assert.throws(() => setMerchantStatus(db, row.normalized_name, 'invalid'))
  } finally { db.close() }
})
