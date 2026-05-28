const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')
const { getDateColumn } = require('../db/index.js')

function Dashboard({ selectedMonth, setSelectedMonth }) {
  const [data, setData] = useState({
    income: 0, expense: 0, balance: 0, bankBalance: 0
  })

  useEffect(() => {
    const dateCol = getDateColumn()
    const [year, month] = selectedMonth.split('-')
    const from = `${year}-${month}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const to = `${year}-${month}-${lastDay}`

    const income = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM Transactions
      WHERE transaction_type='Income' AND is_budgetary=1
      AND ${dateCol} BETWEEN ? AND ?
    `).get(from, to).v

    const expense = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as v FROM Transactions
      WHERE transaction_type='Expense' AND is_budgetary=1
      AND ${dateCol} BETWEEN ? AND ?
    `).get(from, to).v

    const accounts = db.prepare(
      'SELECT id, opening_balance FROM Accounts WHERE is_active=1'
    ).all()

    let bankBalance = 0
    accounts.forEach(acc => {
      const stats = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type='Income'  THEN amount ELSE 0 END), 0) as inc,
          COALESCE(SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) as exp
        FROM Transactions WHERE account_id=?
      `).get(acc.id)
      bankBalance += acc.opening_balance + stats.inc - stats.exp
    })

    setData({ income, expense, balance: income - expense, bankBalance })
  }, [selectedMonth])

  const fmt = n => '₪' + Math.abs(n).toLocaleString('he-IL')

  const months = React.useMemo(() => {
    const dateCol = getDateColumn()
    const rows = db.prepare(`
      SELECT DISTINCT substr(${dateCol}, 1, 7) as month
      FROM Transactions
      WHERE ${dateCol} IS NOT NULL AND ${dateCol} != ''
      ORDER BY month DESC
    `).all()
    return rows
      .map(r => ({
        val: r.month,
        label: new Date(r.month + '-01').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
      }))
      .filter(r => r.label !== 'Invalid Date')
  }, [])

  return React.createElement('div', { style: styles.page },
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'דשבורד'),
      React.createElement('select', {
        style: styles.select,
        value: selectedMonth,
        onChange: e => setSelectedMonth(e.target.value),
      },
        months.map(m => React.createElement('option', { key: m.val, value: m.val }, m.label))
      )
    ),
    React.createElement('div', { style: styles.grid4 },
      KpiCard('הכנסות',      fmt(data.income),      '#10B981'),
      KpiCard('הוצאות',      fmt(data.expense),     '#E11D48'),
      KpiCard('יתרה חודשית', fmt(data.balance),     data.balance >= 0 ? '#2563EB' : '#E11D48'),
      KpiCard('יתרת בנקים',  fmt(data.bankBalance), '#0F172A'),
    )
  )
}

function KpiCard(label, value, color) {
  return React.createElement('div', { key: label, style: styles.card },
    React.createElement('p', { style: styles.cardLabel }, label),
    React.createElement('p', { style: { ...styles.cardValue, color } }, value),
  )
}

const styles = {
  page:      { padding: 32 },
  header:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title:     { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  select:    { border: '1px solid #E2E8F0', borderRadius: 10, padding: '6px 12px', fontSize: 13 },
  grid4:     { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 },
  card:      { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: 20 },
  cardLabel: { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  cardValue: { fontSize: 24, fontWeight: 'bold' },
}

module.exports = Dashboard