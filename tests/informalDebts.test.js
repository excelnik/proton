const test = require('node:test')
const assert = require('node:assert/strict')
const Database = require('better-sqlite3')
const { runMigrations } = require('../src/db/migrations')
const { createInformalDebt, recordInformalDebtPayment, listInformalDebts } = require('../src/lib/informalDebts')

function makeDb() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE Accounts (id INTEGER PRIMARY KEY);
    CREATE TABLE Transactions (id INTEGER PRIMARY KEY, amount REAL NOT NULL, transaction_type TEXT NOT NULL);
    CREATE TABLE Assets (id INTEGER PRIMARY KEY);
    CREATE TABLE Automation_Rules (id INTEGER PRIMARY KEY, original_string TEXT, cleaned_name TEXT, category_id INTEGER, match_type TEXT, priority INTEGER, use_count INTEGER);
    CREATE TABLE Insurance_Policies (id INTEGER PRIMARY KEY);
    CREATE TABLE Liabilities (id INTEGER PRIMARY KEY);
    CREATE TABLE Recurring_Templates (id INTEGER PRIMARY KEY);
    CREATE TABLE Savings_Goals (id INTEGER PRIMARY KEY);
    CREATE TABLE Informal_Debts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, amount REAL NOT NULL, direction TEXT NOT NULL DEFAULT 'borrowed', due_date TEXT, notes TEXT, is_active INTEGER NOT NULL DEFAULT 1);
  `)
  runMigrations(db)
  return db
}

test('tracks personal debts in both directions and closes a debt when fully repaid', () => {
  const db = makeDb()
  try {
    const lent = createInformalDebt(db, { name: 'Friend', amount: 1000, direction: 'lent' })
    recordInformalDebtPayment(db, { debt_id: lent, amount: 400, payment_date: '2026-11-15' })
    assert.equal(listInformalDebts(db)[0].remaining_amount, 600)
    recordInformalDebtPayment(db, { debt_id: lent, amount: 600, payment_date: '2026-11-16' })
    assert.equal(listInformalDebts(db)[0].is_active, 0)
    assert.equal(listInformalDebts(db)[0].remaining_amount, 0)
    const borrowed = createInformalDebt(db, { name: 'Family', amount: 250, direction: 'borrowed' })
    assert.equal(listInformalDebts(db).find(x => x.id === borrowed).direction, 'borrowed')
  } finally { db.close() }
})

test('rejects repayments larger than the remaining balance and validates linked transaction type and amount', () => {
  const db = makeDb()
  try {
    const debtId = createInformalDebt(db, { name: 'Friend', amount: 100, direction: 'lent' })
    db.prepare('INSERT INTO Transactions (amount, transaction_type) VALUES (?, ?)').run(50, 'Expense')
    db.prepare('INSERT INTO Transactions (amount, transaction_type) VALUES (?, ?)').run(49, 'Income')
    db.prepare('INSERT INTO Transactions (amount, transaction_type) VALUES (?, ?)').run(50, 'Income')
    assert.throws(() => recordInformalDebtPayment(db, { debt_id: debtId, amount: 101, payment_date: '2026-11-15' }), /גדול מהיתרה/)
    assert.throws(() => recordInformalDebtPayment(db, { debt_id: debtId, amount: 50, payment_date: '2026-11-15', transaction_id: 1 }), /סוג התנועה/)
    assert.throws(() => recordInformalDebtPayment(db, { debt_id: debtId, amount: 50, payment_date: '2026-11-15', transaction_id: 2 }), /זהה/)
    recordInformalDebtPayment(db, { debt_id: debtId, amount: 50, payment_date: '2026-11-15', transaction_id: 3 })
    assert.throws(() => recordInformalDebtPayment(db, { debt_id: debtId, amount: 1, payment_date: '2026-11-15', transaction_id: 3 }))
  } finally { db.close() }
})
