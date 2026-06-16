const React = require('react')
const { useState, useEffect, useMemo } = React
const db = require('../db/index.js')
const { getDateColumn } = require('../db/index.js')
const { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend } = require('recharts')

function Dashboard({ selectedMonth, setSelectedMonth }) {
  const [months, setMonths] = useState([])
  const [data, setData] = useState(null)
  const [donutMode, setDonutMode] = useState('month')


  function loadMonths() {
    const rows = db.prepare(`
      SELECT DISTINCT substr(transaction_date, 1, 7) as month
      FROM Transactions
      ORDER BY month DESC
    `).all()
    setMonths(rows.map(r => r.month).filter(m => m && !isNaN(new Date(m))))
  }

  function loadData() {
    const dateCol = getDateColumn()
    const [year, month] = selectedMonth.split('-')

    // הכנסות והוצאות
    const income = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM Transactions
      WHERE transaction_type='Income' AND is_budgetary=1
      AND substr(${dateCol},1,7)=?
    `).get(selectedMonth).v

    const expenses = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM Transactions
      WHERE transaction_type='Expense' AND is_budgetary=1
      AND substr(${dateCol},1,7)=?
    `).get(selectedMonth).v

    // יתרת בנקים
    const bankAccounts = db.prepare("SELECT * FROM Accounts WHERE is_active=1 AND type IN ('Bank','Cash')").all()
    let bankBalance = 0
    for (const acc of bankAccounts) {
      const stats = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type='Income' THEN amount ELSE 0 END), 0) as inc,
          COALESCE(SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) as exp
        FROM Transactions WHERE account_id=?
        AND transaction_date <= ?
      `).get(acc.id, selectedMonth === 'all' ? '2999-12-31' : `${selectedMonth}-31`)
      bankBalance += acc.opening_balance + stats.inc - stats.exp
    }

    // תקציב
    const budgetTotal = db.prepare(`
      SELECT COALESCE(SUM(planned_amount), 0) as v FROM Budget_Goals
      WHERE substr(budget_period,1,7)=?
    `).get(selectedMonth).v

    // התפלגות הוצאות לפי קטגוריה
    const expByCategory = db.prepare(`
      SELECT c.name, c.color, c.icon, COALESCE(SUM(t.amount), 0) as total
      FROM Transactions t
      LEFT JOIN Categories c ON t.category_id=c.id
      WHERE t.transaction_type='Expense' AND t.is_budgetary=1
      AND substr(t.${dateCol},1,7)=?
      GROUP BY t.category_id
      ORDER BY total DESC
      LIMIT 6
    `).all(selectedMonth)

    // שווי נקי
    const allAccounts = db.prepare("SELECT * FROM Accounts WHERE is_active=1").all()
    let totalAssets = 0
    for (const acc of allAccounts) {
      if (acc.type === 'Credit_Card') continue
      const stats = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type='Income' THEN amount ELSE 0 END), 0) as inc,
          COALESCE(SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) as exp
        FROM Transactions WHERE account_id=?
      `).get(acc.id)
      const bal = acc.opening_balance + stats.inc - stats.exp
      if (bal > 0) totalAssets += bal
    }
    try {
      const assets = db.prepare("SELECT SUM(current_value * COALESCE(quantity,1)) as v FROM Assets WHERE is_active=1").get()
      totalAssets += assets?.v || 0
    } catch {}

    const loansTotal = (() => {
      try {
        const loans = db.prepare('SELECT * FROM Liabilities WHERE is_active=1').all()
        return loans.reduce((s, loan) => {
          const monthlyRate = loan.interest_rate / 100 / 12
          const activeDuration = loan.duration_months - (loan.grace_period_months || 0)
          const pmt = monthlyRate === 0
            ? loan.total_amount / activeDuration
            : (loan.total_amount * monthlyRate * Math.pow(1 + monthlyRate, activeDuration)) /
              (Math.pow(1 + monthlyRate, activeDuration) - 1)
          let balance = loan.total_amount
          const start = new Date(loan.first_payment_date)
          const today = new Date()
          const monthsPassed = Math.max(0, Math.min(
            (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth()),
            loan.duration_months
          ))
          for (let i = 0; i < monthsPassed; i++) {
            if (i >= (loan.grace_period_months || 0)) {
              const interest = balance * monthlyRate
              balance = Math.max(0, balance - (pmt - interest))
            }
          }
          return s + balance
        }, 0)
      } catch { return 0 }
    })()

    const creditDebt = allAccounts.filter(a => a.type === 'Credit_Card').reduce((s, acc) => {
      const stats = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type='Income' THEN amount ELSE 0 END), 0) as inc,
          COALESCE(SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) as exp
        FROM Transactions WHERE account_id=?
      `).get(acc.id)
      const bal = acc.opening_balance + stats.inc - stats.exp
      return s + (bal < 0 ? Math.abs(bal) : 0)
    }, 0)

    const totalLiabilities = loansTotal + creditDebt

    // מעשרות
    const maaserRate = parseFloat(db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string='maaser_rate_setting' AND match_type='setting'"
    ).get()?.cleaned_name || '0.1')

    const maaserIncome = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM Transactions
      WHERE transaction_type='Income' AND is_maaser_obligated=1
      AND substr(${dateCol},1,7)=?
    `).get(selectedMonth).v

    const maaserObligation = maaserIncome * maaserRate

    const maaserPaid = db.prepare(`
      SELECT COALESCE(SUM(t.amount), 0) as v FROM Transactions t
      LEFT JOIN Categories c ON t.category_id=c.id
      WHERE t.transaction_type='Expense'
      AND (c.name LIKE '%מעשר%' OR c.name LIKE '%צדקה%' OR c.name LIKE '%תרומ%')
      AND substr(t.${dateCol},1,7)=?
    `).get(selectedMonth).v

    // חיסכון
    const savingsMonth = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM Transactions
      WHERE transaction_type='Savings' AND substr(${dateCol},1,7)=?
    `).get(selectedMonth).v

    // נתוני 6 חודשים אחרונים
    const last6 = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(parseInt(year), parseInt(month) - 1 - i, 1)
      const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const inc = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM Transactions WHERE transaction_type='Income' AND is_budgetary=1 AND substr(${dateCol},1,7)=?`).get(m).v
      const exp = db.prepare(`SELECT COALESCE(SUM(amount),0) as v FROM Transactions WHERE transaction_type='Expense' AND is_budgetary=1 AND substr(${dateCol},1,7)=?`).get(m).v
      last6.push({ month: m.slice(5), income: Math.round(inc), expenses: Math.round(exp) })
    }

    // תקציב לפי קטגוריה
    const budgetByCategory = db.prepare(`
      SELECT bg.category_id, bg.planned_amount, c.name, c.icon, c.color
      FROM Budget_Goals bg
      LEFT JOIN Categories c ON bg.category_id=c.id
      WHERE substr(bg.budget_period,1,7)=?
      ORDER BY bg.planned_amount DESC
    `).all(selectedMonth).map(row => {
      const spent = db.prepare(`
        SELECT COALESCE(SUM(amount),0) as v FROM Transactions
        WHERE category_id=? AND transaction_type='Expense'
        AND is_budgetary=1 AND substr(${dateCol},1,7)=?
      `).get(row.category_id, selectedMonth).v
      return { ...row, spent: Math.round(spent) }
    })

    // התפלגות ל-12 חודשים
    const twelveMonthsAgo = new Date(parseInt(year), parseInt(month) - 13, 1)
    const fromMonth = `${twelveMonthsAgo.getFullYear()}-${String(twelveMonthsAgo.getMonth() + 1).padStart(2, '0')}`
    const expByCategory12 = db.prepare(`
      SELECT c.name, c.color, c.icon, COALESCE(SUM(t.amount), 0) as total
      FROM Transactions t
      LEFT JOIN Categories c ON t.category_id=c.id
      WHERE t.transaction_type='Expense' AND t.is_budgetary=1
      AND substr(t.${dateCol},1,7) >= ? AND substr(t.${dateCol},1,7) <= ?
      GROUP BY t.category_id
      ORDER BY total DESC
      LIMIT 6
    `).all(fromMonth, selectedMonth)

    setData({
      income, expenses, bankBalance, budgetTotal, expByCategory,
      totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities,
      maaserObligation, maaserPaid, maaserRate, savingsMonth, last6, budgetByCategory, expByCategory12, budgetByCategory,
    })
  }

  useEffect(() => { loadMonths() }, [])
  useEffect(() => { loadData() }, [selectedMonth])

  if (!data) return React.createElement('div', { style: { padding: 24 } }, 'טוען...')

  const fmt = n => '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL')
  const budgetPct = data.budgetTotal > 0 ? Math.round((data.expenses / data.budgetTotal) * 100) : 0
  const budgetColor = budgetPct >= 100 ? '#E11D48' : budgetPct >= 80 ? '#F59E0B' : '#10B981'
  const maaserBalance = data.maaserObligation - data.maaserPaid
  const totalExpenses = data.expByCategory.reduce((s, c) => s + c.total, 0)

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'דשבורד'),
      React.createElement('select', {
        style: styles.monthPicker,
        value: selectedMonth,
        onChange: e => setSelectedMonth(e.target.value),
      },
        months.map(m => React.createElement('option', { key: m, value: m }, m))
      ),
    ),

    // שורה 1 — KPI
    React.createElement('div', { style: styles.grid4 },
      KpiCard('הכנסות', fmt(data.income), '#10B981', '↑'),
      KpiCard('הוצאות', fmt(data.expenses), '#E11D48', '↓'),
      KpiCard('יתרה חודשית', fmt(data.income - data.expenses), data.income >= data.expenses ? '#10B981' : '#E11D48', data.income >= data.expenses ? '✓' : '!'),
      KpiCard('יתרת בנקים', `${data.bankBalance < 0 ? '−' : ''}${fmt(data.bankBalance)}`, data.bankBalance < 0 ? '#E11D48' : '#2563EB', '🏦'),
    ),

    // שורה 2 — בקרת תקציב
    React.createElement('div', { style: styles.card },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 } },
        React.createElement('p', { style: styles.cardTitle }, '📊 ניצול תקציב חודשי כולל'),
        data.budgetTotal > 0
          ? React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: budgetColor } }, `${budgetPct}% נוצל`)
          : React.createElement('p', { style: { fontSize: 12, color: '#94A3B8' } }, 'לא הוגדר תקציב חודשי'),
      ),
      React.createElement('div', { style: { height: 14, backgroundColor: '#E2E8F0', borderRadius: 7, overflow: 'hidden', marginBottom: 8 } },
        React.createElement('div', {
          style: { height: '100%', borderRadius: 7, backgroundColor: data.budgetTotal > 0 ? budgetColor : '#E2E8F0', width: `${Math.min(100, budgetPct)}%`, transition: 'width 0.4s' }
        })
      ),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#64748B', marginBottom: data.budgetByCategory.length > 0 ? 16 : 0 } },
        React.createElement('span', null, data.budgetTotal > 0 ? `נוצלו ${fmt(data.expenses)}` : 'עבור למסך "תכנון תקציב" כדי להגדיר מסגרות.'),
        data.budgetTotal > 0 && React.createElement('span', null, `מתוך ${fmt(data.budgetTotal)}`),
      ),

      // ניצול לפי קטגוריה
      data.budgetByCategory.length > 0 && React.createElement('div', null,
        React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 12, paddingTop: 12, borderTop: '1px solid #E2E8F0' } },
          'ניצול תקציב לפי קטגוריות (הוצאות)'
        ),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 24px' } },
          data.budgetByCategory.map((cat, i) => {
            const pct = cat.planned_amount > 0 ? Math.min(100, Math.round((cat.spent / cat.planned_amount) * 100)) : 0
            const colors = ['#F59E0B', '#6366F1', '#E11D48', '#10B981', '#3B82F6', '#EC4899', '#14B8A6', '#F97316', '#8B5CF6', '#84CC16']
            const color = cat.color || colors[i % colors.length]
            const barColor = pct >= 100 ? '#E11D48' : pct >= 80 ? '#F59E0B' : color
            return React.createElement('div', { key: i, style: { marginBottom: 4 } },
              React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 } },
                React.createElement('span', { style: { fontWeight: '600', color: '#0F172A' } }, `${cat.icon || ''} ${cat.name || 'ללא'}`),
                React.createElement('span', { style: { color: '#64748B' } }, `₪${cat.spent.toLocaleString('he-IL')} / ₪${Math.round(cat.planned_amount).toLocaleString('he-IL')}`),
              ),
              React.createElement('div', { style: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' } },
                React.createElement('div', { style: { height: '100%', borderRadius: 4, backgroundColor: barColor, width: `${pct}%`, transition: 'width 0.3s' } })
              ),
            )
          })
        ),
      ),
    ),

    // שורה 3 — שווי נקי
    React.createElement('div', { style: styles.grid3 },
      NetWorthCard('נכסים', fmt(data.totalAssets), '#10B981'),
      NetWorthCard('התחייבויות', fmt(data.totalLiabilities), '#E11D48'),
      NetWorthCard('שווי נקי', fmt(data.netWorth), data.netWorth >= 0 ? '#2563EB' : '#E11D48'),
    ),

    // שורה 4 — גרף עמודות + חיסכון
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16, marginBottom: 16 } },

      // גרף עמודות השוואתי
      React.createElement('div', { style: styles.card },
        React.createElement('p', { style: { ...styles.cardTitle, marginBottom: 16 } }, '📊 הכנסות מול הוצאות'),
        React.createElement(ResponsiveContainer, { width: '100%', height: 200 },
          React.createElement(BarChart, { data: data.last6, margin: { top: 0, right: 0, left: 0, bottom: 0 } },
            React.createElement(XAxis, { dataKey: 'month', tick: { fontSize: 11 } }),
            React.createElement(YAxis, { tick: { fontSize: 11 }, width: 60, tickFormatter: v => `₪${(v/1000).toFixed(0)}K` }),
            React.createElement(Tooltip, { formatter: (v) => [`₪${v.toLocaleString('he-IL')}`, ''] }),
            React.createElement(Bar, { dataKey: 'income', name: 'הכנסות', fill: '#10B981', radius: [4, 4, 0, 0] }),
            React.createElement(Bar, { dataKey: 'expenses', name: 'הוצאות', fill: '#E11D48', radius: [4, 4, 0, 0] }),
          )
        ),
      ),

      // חיסכון
      React.createElement('div', { style: styles.card },
        React.createElement('p', { style: { ...styles.cardTitle, marginBottom: 12 } }, '💰 חיסכון'),
        React.createElement('div', { style: { textAlign: 'center', padding: '12px 0' } },
          React.createElement('p', { style: { fontSize: 28, fontWeight: 'bold', color: '#10B981', marginBottom: 4 } }, fmt(data.savingsMonth)),
          React.createElement('p', { style: { fontSize: 12, color: '#94A3B8' } }, 'הופרש לחיסכון החודש'),
        ),
      ),
    ),

    // שורה 5 — התפלגות הוצאות
    React.createElement('div', { style: { ...styles.card, marginBottom: 16 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 } },
        React.createElement('p', { style: styles.cardTitle }, '🥧 התפלגות הוצאות'),
        React.createElement('div', { style: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 8, overflow: 'hidden' } },
          React.createElement('button', {
            style: { padding: '4px 10px', border: 'none', fontSize: 11, cursor: 'pointer', backgroundColor: donutMode === 'month' ? '#2563EB' : '#F8FAFC', color: donutMode === 'month' ? '#fff' : '#475569' },
            onClick: () => setDonutMode('month'),
          }, 'חודש'),
          React.createElement('button', {
            style: { padding: '4px 10px', border: 'none', fontSize: 11, cursor: 'pointer', backgroundColor: donutMode === 'year' ? '#2563EB' : '#F8FAFC', color: donutMode === 'year' ? '#fff' : '#475569' },
            onClick: () => setDonutMode('year'),
          }, '12 חודש'),
        ),
      ),
      data.expByCategory.length === 0
        ? React.createElement('p', { style: { color: '#94A3B8', fontSize: 13 } }, 'אין נתונים')
        : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, alignItems: 'center' } },
            // דונאט
            React.createElement(ResponsiveContainer, { width: '100%', height: 180 },
              React.createElement(PieChart, null,
                React.createElement(Pie, {
                  data: (donutMode === 'month' ? data.expByCategory : data.expByCategory12 || data.expByCategory).map(c => ({ name: c.name || 'ללא', value: Math.round(c.total) })),
                  cx: '50%', cy: '50%',
                  innerRadius: 50, outerRadius: 80,
                  dataKey: 'value',
                },
                  data.expByCategory.map((cat, i) => {
                    const colors = ['#E11D48', '#F59E0B', '#2563EB', '#10B981', '#8B5CF6', '#64748B']
                    return React.createElement(Cell, { key: i, fill: cat.color || colors[i % colors.length] })
                  })
                ),
                React.createElement(Tooltip, { formatter: v => [`₪${v.toLocaleString('he-IL')}`, ''] }),
              )
            ),
            // רשימה
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              (donutMode === 'month' ? data.expByCategory : (data.expByCategory12 || data.expByCategory)).map((cat, i) => {
                const colors = ['#E11D48', '#F59E0B', '#2563EB', '#10B981', '#8B5CF6', '#64748B']
                const color = cat.color || colors[i % colors.length]
                const pct = totalExpenses > 0 ? Math.round((cat.total / totalExpenses) * 100) : 0
                return React.createElement('div', { key: i, style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  React.createElement('div', { style: { width: 10, height: 10, borderRadius: '50%', backgroundColor: color, flexShrink: 0 } }),
                  React.createElement('span', { style: { fontSize: 12, color: '#475569', flex: 1 } }, `${cat.icon || ''} ${cat.name || 'ללא'}`),
                  React.createElement('span', { style: { fontSize: 12, fontWeight: '600', color: '#0F172A' } }, `${pct}%`),
                )
              })
            ),
          )
    ),

    // שורה 5 — מוטו + מעשרות
    React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 } },

      // מוטו
      React.createElement('div', { style: { ...styles.card, backgroundColor: '#0F172A', display: 'flex', flexDirection: 'column', justifyContent: 'center' } },
        React.createElement('p', { style: { fontSize: 13, color: '#94A3B8', marginBottom: 12, textAlign: 'center' } }, 'סידור יעב"ץ'),
        React.createElement('p', { style: { fontSize: 14, color: '#F8FAFC', lineHeight: 2, textAlign: 'center', fontWeight: '500' } },
          'ועיין בהוצאה לעומת הכנסה'
        ),
        React.createElement('p', { style: { fontSize: 14, color: '#F8FAFC', lineHeight: 2, textAlign: 'center', fontWeight: '500' } },
          'וסדר ההוצאה הוא חצי פרנסה'
        ),
        React.createElement('p', { style: { fontSize: 14, color: '#F8FAFC', lineHeight: 2, textAlign: 'center', fontWeight: '500' } },
          'ובמקום גדולים אל תעמוד'
        ),
        React.createElement('p', { style: { fontSize: 14, color: '#F8FAFC', lineHeight: 2, textAlign: 'center', fontWeight: '500' } },
          'ולשלחנם לא תחמוד'
        ),
      ),

      // מעשרות
      React.createElement('div', { style: styles.card },
        React.createElement('p', { style: { ...styles.cardTitle, marginBottom: 12 } },
          `${data.maaserRate === 0.2 ? '⅕ חומש' : '⅒ מעשר'}`
        ),
        React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          MaaserRow('חובה החודש', fmt(data.maaserObligation), '#0F172A'),
          MaaserRow('שולם', fmt(data.maaserPaid), '#10B981'),
          React.createElement('div', { style: { height: 1, backgroundColor: '#E2E8F0', margin: '4px 0' } }),
          MaaserRow('יתרה לתשלום', fmt(Math.max(0, maaserBalance)), maaserBalance <= 0 ? '#10B981' : '#E11D48'),
        ),
        maaserBalance <= 0 && React.createElement('p', { style: { fontSize: 12, color: '#10B981', marginTop: 8, textAlign: 'center' } }, '✓ המעשר שולם במלואו!'),
      ),
    ),
  )
}

function KpiCard(label, value, color, icon) {
  return React.createElement('div', { style: styles.kpiCard },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' } },
      React.createElement('p', { style: styles.kpiLabel }, label),
      React.createElement('span', { style: { fontSize: 16 } }, icon),
    ),
    React.createElement('p', { style: { ...styles.kpiValue, color } }, value),
  )
}

function NetWorthCard(label, value, color) {
  return React.createElement('div', { style: { ...styles.card, textAlign: 'center' } },
    React.createElement('p', { style: { fontSize: 12, color: '#94A3B8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' } }, label),
    React.createElement('p', { style: { fontSize: 22, fontWeight: 'bold', color } }, value),
  )
}

function MaaserRow(label, value, color) {
  return React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
    React.createElement('span', { style: { fontSize: 13, color: '#475569' } }, label),
    React.createElement('span', { style: { fontSize: 14, fontWeight: '600', color } }, value),
  )
}

const styles = {
  page: { padding: 24, overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  monthPicker: { border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 12px', fontSize: 13, outline: 'none' },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 },
  kpiCard: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  kpiLabel: { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: 'bold' },
  card: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16, marginBottom: 16 },
  cardTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
}

module.exports = Dashboard