#!/usr/bin/env node
/**
 * seed-demo.js — מזריק 3 חודשים של נתוני דמו ל-Proton (כולל שווי נקי)
 *
 * הרצה:
 *   node seed-demo.js            יצירה מחדש (מנקה דמו קודם ויוצר חדש)
 *   node seed-demo.js --clean    ניקוי בלבד, בלי יצירה
 *
 * אם הנתיב ל-DB אינו ברירת המחדל, אפשר לקבוע:
 *   set PROTON_DB_PATH=C:\path\to\folder  (Windows, ללא proton.db בסוף)
 *
 * דרישת קדם: הקטגוריות חייבות להיות קיימות כבר (הרצת את האפליקציה/index.js
 * לפחות פעם אחת לפני כן).
 */
const Database = require('better-sqlite3')
const path = require('path')
const os = require('os')

const DB_DIR = process.env.PROTON_DB_PATH
  ?? path.join(os.homedir(), 'AppData', 'Roaming', 'proton')
const db = new Database(path.join(DB_DIR, 'proton.db'))
db.pragma('foreign_keys = ON')

const TAG = '[DEMO]'
const onlyClean = process.argv.includes('--clean')

// ────────────────────────── ניקוי (אידמפוטנטי) ──────────────────────────
function clean() {
  db.exec(`DELETE FROM Transactions WHERE source = 'demo'`)
  db.exec(`DELETE FROM Recurring_Templates WHERE name LIKE '${TAG}%'`)
  db.exec(`DELETE FROM Liabilities WHERE name LIKE '${TAG}%'`)
  db.exec(`DELETE FROM Insurance_Policies WHERE name LIKE '${TAG}%'`)
  db.exec(`DELETE FROM Assets WHERE name LIKE '${TAG}%'`)
  db.exec(`DELETE FROM Net_Worth_Snapshots WHERE notes = 'demo'`)
  db.exec(`DELETE FROM Accounts WHERE name LIKE '${TAG}%'`)
  db.exec(`DELETE FROM Price_Cache WHERE ticker IN ('AAPL','TEVA.TA','SPY')`)
}

clean()
console.log('נוקו נתוני דמו קודמים (אם היו).')
if (onlyClean) {
  db.close()
  process.exit(0)
}

// ────────────────────────────── עזרים ──────────────────────────────
const rand  = (min, max) => Math.random() * (max - min) + min
const randI = (min, max) => Math.floor(rand(min, max + 1))
const pick  = arr => arr[randI(0, arr.length - 1)]
const fmt   = d => d.toISOString().slice(0, 10)

// תאריך לפי "לפני כמה חודשים" + יום בחודש (חודשים שליליים = בעתיד)
function dateInMonth(monthsAgo, day) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - monthsAgo)
  d.setDate(day)
  return fmt(d)
}

// ───────────────────────── קטגוריות (חיפוש לפי שם) ─────────────────────────
const catRow = name => db.prepare('SELECT id FROM Categories WHERE name = ?').get(name)
const need = name => {
  const row = catRow(name)
  if (!row) throw new Error(`קטגוריה "${name}" לא נמצאה — הרץ את האפליקציה/index.js פעם אחת קודם.`)
  return row.id
}
const CAT = {
  food:        need('מזון ושתייה'),
  transport:   need('תחבורה'),
  housing:     need('מגורים'),
  health:      need('בריאות'),
  insurance:   need('ביטוחים'),
  fun:         need('בידור ופנאי'),
  charity:     need('תרומות וצדקה'),
  salary:      need('משכורת'),
  extraIncome: need('הכנסה נוספת'),
}

// ────────────────────────────── חשבונות ──────────────────────────────
const insAccount = db.prepare(`INSERT INTO Accounts (name, type, opening_balance) VALUES (?,?,?)`)
const checking = insAccount.run(`${TAG} עו"ש`, 'Bank', 12000).lastInsertRowid
const credit   = insAccount.run(`${TAG} כרטיס אשראי`, 'Credit_Card', 0).lastInsertRowid
const cash     = insAccount.run(`${TAG} מזומן`, 'Cash', 350).lastInsertRowid

// ────────────────────────────── הוראות קבע ──────────────────────────────
const insRecurring = db.prepare(`
  INSERT INTO Recurring_Templates
    (name, type, amount, frequency, charge_day, first_charge_date, account_id, category_id, is_budgetary, is_maaser_obligated)
  VALUES (?,?,?,?,?,?,?,?,?,?)
`)
const rentRecurringId   = insRecurring.run(`${TAG} שכירות`, 'recurring', 4500, 'monthly', 1, dateInMonth(2, 1), checking, CAT.housing, 1, 0).lastInsertRowid
const maaserRecurringId = insRecurring.run(`${TAG} מעשר`,   'recurring', 1500, 'monthly', 5, dateInMonth(2, 5), checking, CAT.charity, 0, 0).lastInsertRowid

// ────────────────────────────── הלוואה ──────────────────────────────
const insLiability = db.prepare(`
  INSERT INTO Liabilities
    (name, total_amount, interest_rate, start_date, first_payment_date, duration_months, account_id, grace_period_months, grace_type)
  VALUES (?,?,?,?,?,?,?,?,?)
`)
const carLoanId = insLiability.run(`${TAG} הלוואת רכב`, 90000, 4.5, dateInMonth(6, 1), dateInMonth(5, 10), 60, checking, 0, 'none').lastInsertRowid

// ────────────────────────────── ביטוח ──────────────────────────────
const insInsurance = db.prepare(`
  INSERT INTO Insurance_Policies
    (name, provider_name, premium_amount, payment_type, renewal_date, category_id, recurring_id)
  VALUES (?,?,?,?,?,?,?)
`)
const carInsuranceId = insInsurance.run(`${TAG} ביטוח רכב`, 'הראל', 280, 'monthly', dateInMonth(-9, 1), CAT.insurance, null).lastInsertRowid

// ────────────────────────────── עסקאות ל-3 חודשים אחרונים ──────────────────────────────
const insTx = db.prepare(`
  INSERT INTO Transactions
    (transaction_date, amount, transaction_type, business_entity, description, category_id, account_id, is_budgetary, is_maaser_obligated, source, liability_id, recurring_id, insurance_id)
  VALUES (?,?,?,?,?,?,?,?,?,'demo',?,?,?)
`)

const merchants = {
  food:      ['שופרסל', 'רמי לוי', 'וולט', 'AM:PM', 'יוחננוף'],
  transport: ['פז', 'דלק', 'רב-קו', 'גט'],
  fun:       ['נטפליקס', 'סינמה סיטי', 'קפה קפה', 'ספוטיפיי'],
  health:    ['סופר-פארם', 'קופת חולים', 'מרפאת שיניים'],
}

for (let m = 2; m >= 0; m--) {
  // משכורת
  insTx.run(dateInMonth(m, 1), 15500 + randI(-500, 800), 'Income', 'מעסיק בע"מ', 'משכורת חודשית',
    CAT.salary, checking, 1, 1, null, null, null)

  // שכירות (מקושר להוראת קבע)
  insTx.run(dateInMonth(m, 1), 4500, 'Expense', 'בעל הבית', 'שכירות',
    CAT.housing, checking, 1, 0, null, rentRecurringId, null)

  // מעשר (מקושר להוראת קבע)
  insTx.run(dateInMonth(m, 5), 1500, 'Expense', 'עמותה', 'מעשר חודשי',
    CAT.charity, checking, 0, 0, null, maaserRecurringId, null)

  // ביטוח רכב (מקושר לפוליסה)
  insTx.run(dateInMonth(m, 10), 280, 'Expense', 'הראל', 'ביטוח רכב חודשי',
    CAT.insurance, checking, 1, 0, null, null, carInsuranceId)

  // תשלום הלוואת רכב (מקושר להלוואה)
  insTx.run(dateInMonth(m, 10), 1650, 'Expense', 'בנק', 'תשלום הלוואת רכב',
    CAT.transport, checking, 1, 0, carLoanId, null, null)

  // הוצאות שוטפות אקראיות, מפוזרות על פני החודש
  for (let d = 1; d <= 27; d += randI(1, 3)) {
    const type = pick(['food', 'food', 'transport', 'fun', 'health'])
    insTx.run(
      dateInMonth(m, d),
      Number(rand(15, type === 'food' ? 350 : 200).toFixed(2)),
      'Expense',
      pick(merchants[type]),
      null,
      CAT[type],
      pick([checking, credit, cash]),
      1, 0, null, null, null
    )
  }

  // הכנסה נוספת מזדמנת (לא בכל חודש)
  if (Math.random() < 0.4) {
    insTx.run(dateInMonth(m, randI(10, 25)), randI(200, 900), 'Income', 'לקוח פרטי', 'עבודה צדדית',
      CAT.extraIncome, checking, 1, 1, null, null, null)
  }
}

// ────────────────────────────── נכסים / ני"ע (שווי נקי) ──────────────────────────────
const insAsset = db.prepare(`
  INSERT INTO Assets
    (name, type, current_value, quantity, ticker_symbol, last_api_price, price_currency, purchase_price, purchase_date, last_updated, exchange)
  VALUES (?,?,?,?,?,?,?,?,?, datetime('now'), ?)
`)
insAsset.run(`${TAG} Apple Inc`,      'Security', 3 * 195,  3,  'AAPL',    195, 'USD', 150, dateInMonth(8, 15), 'NASDAQ')
insAsset.run(`${TAG} טבע`,            'Security', 50 * 38,  50, 'TEVA.TA', 38,  'ILS', 32,  dateInMonth(10, 1), 'TASE')
insAsset.run(`${TAG} S&P 500 ETF`,    'Security', 10 * 560, 10, 'SPY',     560, 'USD', 480, dateInMonth(11, 1), 'NYSE')
insAsset.run(`${TAG} חסכון לכל ילד`,  'Other',    8200,     1,  null,      null,'ILS', null, null,              null)

// קאש מחירים — כדי שהטאב יראה נתון לפני קריאה ל-Yahoo Finance
const insPrice = db.prepare(`INSERT OR REPLACE INTO Price_Cache (ticker, price, currency, change_pct) VALUES (?,?,?,?)`)
insPrice.run('AAPL', 195, 'USD', 1.2)
insPrice.run('TEVA.TA', 38, 'ILS', -0.4)
insPrice.run('SPY', 560, 'USD', 0.6)

// ────────────────────────────── snapshots לגרף מגמה ──────────────────────────────
const insSnap = db.prepare(`
  INSERT INTO Net_Worth_Snapshots (snapshot_date, total_assets, total_liabilities, net_worth, notes)
  VALUES (?,?,?,?, 'demo')
`)
for (let m = 2; m >= 0; m--) {
  const assets = 95000 + (2 - m) * 4000 + randI(-1000, 1000)
  const liabilities = 90000 - (2 - m) * 1650
  insSnap.run(dateInMonth(m, 28), assets, liabilities, assets - liabilities)
}

console.log('✅ נוצרו נתוני דמו: 3 חשבונות, 3 חודשי עסקאות, הוראת קבע, הלוואה, ביטוח, 4 נכסים ו-3 snapshots לשווי נקי.')
console.log(`חשבונות: עו"ש=${checking}, אשראי=${credit}, מזומן=${cash}`)
db.close()