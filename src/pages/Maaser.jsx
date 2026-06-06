const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')
const { getDateColumn } = require('../db/index.js')

const DONATION_CATEGORY_ID = 8
const MAASER_RATE_KEY = 'maaser_rate_setting'

function getSavedRate() {
  try {
    const row = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string=? AND match_type='setting'"
    ).get(MAASER_RATE_KEY)
    return row ? parseFloat(row.cleaned_name) : 0.1
  } catch { return 0.1 }
}

function saveRate(rate) {
  try {
    const exists = db.prepare(
      "SELECT id FROM Automation_Rules WHERE original_string=? AND match_type='setting'"
    ).get(MAASER_RATE_KEY)
    if (exists) {
      db.prepare("UPDATE Automation_Rules SET cleaned_name=? WHERE original_string=? AND match_type='setting'")
        .run(String(rate), MAASER_RATE_KEY)
    } else {
      db.prepare("INSERT INTO Automation_Rules (original_string, cleaned_name, match_type, priority, use_count) VALUES (?,?,'setting',0,0)")
        .run(MAASER_RATE_KEY, String(rate))
    }
  } catch {}
}

function Maaser({ selectedMonth, setSelectedMonth }) {
  const [rate, setRate] = useState(() => getSavedRate())
  const [period, setPeriod] = useState('all')
  const [summary, setSummary] = useState({
    obligatedIncome: 0, exemptExpenses: 0, taxableBase: 0,
    target: 0, paid: 0, balance: 0,
    maaser10: 0, chomesh10: 0, paid10: 0, paid20: 0,
  })
  const [transactions, setTransactions] = useState([])
  const [saving, setSaving] = useState(null)

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

  function handleRateChange(newRate) {
    setRate(newRate)
    saveRate(newRate)
  }

  function loadData() {
    const dateCol = getDateColumn()
    const ds = period === 'all' ? '' : `AND ${dateCol} LIKE '${period}%'`
    const dst = period === 'all' ? '' : `AND t.${dateCol} LIKE '${period}%'`
    console.log('period:', period, 'dst:', dst)

    const income = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as v FROM Transactions WHERE transaction_type='Income' AND is_maaser_obligated=1 ${ds}`
    ).get().v

    const exemptExpenses = db.prepare(
        `SELECT COALESCE(SUM(amount),0) as v FROM Transactions 
        WHERE transaction_type='Expense' AND is_maaser_obligated=0 
        AND (category_id IS NULL OR category_id != ?) ${ds}`
    ).get(DONATION_CATEGORY_ID).v

    const paid = db.prepare(
      `SELECT COALESCE(SUM(amount),0) as v FROM Transactions WHERE transaction_type='Expense' AND category_id=? ${ds}`
    ).get(DONATION_CATEGORY_ID).v

    const taxableBase = Math.max(0, income - exemptExpenses)
    const maaser10 = taxableBase * 0.1
    const chomesh10 = taxableBase * 0.1
    const target = taxableBase * rate

    // כמה שולם לטובת מעשר לעומת חומש
    const paid10 = Math.min(paid, maaser10)
    const paid20 = Math.max(0, paid - maaser10)

    setSummary({
      obligatedIncome: income, exemptExpenses, taxableBase,
      target, paid, balance: target - paid,
      maaser10, chomesh10, paid10, paid20,
    })

    // כל התנועות — הכנסות + כל ההוצאות
    const txs = db.prepare(`
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM Transactions t
      LEFT JOIN Categories c ON t.category_id = c.id
      LEFT JOIN Accounts a ON t.account_id = a.id
      WHERE (t.transaction_type = 'Income' OR t.transaction_type = 'Expense')
      ${dst}
      ORDER BY t.transaction_date DESC
    `).all()

    setTransactions(txs)
  }

  useEffect(() => { loadData() }, [rate, period])

  function toggleMaaserStatus(tx) {
    setSaving(tx.id)
    const newVal = tx.is_maaser_obligated ? 0 : 1
    db.prepare('UPDATE Transactions SET is_maaser_obligated=? WHERE id=?').run(newVal, tx.id)
    setTransactions(prev =>
      prev.map(t => t.id === tx.id ? { ...t, is_maaser_obligated: newVal } : t)
    )
    setTimeout(() => { loadData(); setSaving(null) }, 100)
  }

  const fmt = n => '₪' + Math.abs(n).toLocaleString('he-IL')

  function getImpact(tx) {
    const isDonation = tx.category_id === DONATION_CATEGORY_ID
    if (isDonation) return { text: `−${fmt(tx.amount)}`, color: '#10B981' }
    if (tx.transaction_type === 'Income' && tx.is_maaser_obligated)
      return { text: `+${fmt(tx.amount * rate)}`, color: '#E11D48' }
    if (tx.transaction_type === 'Income' && !tx.is_maaser_obligated)
      return { text: 'פטור', color: '#94A3B8' }
    if (tx.transaction_type === 'Expense' && !tx.is_maaser_obligated && !isDonation)
      return { text: `−${fmt(tx.amount)} מבסיס`, color: '#10B981' }
    return { text: '—', color: '#94A3B8' }
  }

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'מעשרות וחומש'),
      React.createElement('div', { style: styles.headerLeft },
        React.createElement('select', {
          style: styles.select,
          value: period,
          onChange: e => setPeriod(e.target.value),
        },
          React.createElement('option', { value: 'all' }, 'כל הזמנים'),
          months.map(m => React.createElement('option', { key: m.val, value: m.val }, m.label))
        ),
        React.createElement('div', { style: styles.toggle },
          React.createElement('button', {
            style: { ...styles.toggleBtn, ...(rate === 0.1 ? styles.toggleActive : {}) },
            onClick: () => handleRateChange(0.1),
          }, '10% מעשר'),
          React.createElement('button', {
            style: { ...styles.toggleBtn, ...(rate === 0.2 ? styles.toggleActive : {}) },
            onClick: () => handleRateChange(0.2),
          }, '20% חומש'),
        ),
      ),
    ),

    // כרטיסי סיכום
    React.createElement('div', { style: styles.grid5 },

      KpiCard('הכנסות חייבות', fmt(summary.obligatedIncome), '#0F172A', 'לפני ניכויים'),
      KpiCard('ניכויי הוצאות', fmt(summary.exemptExpenses), '#F59E0B', 'הוצאות פטורות ממעשר'),

      // כרטיס סכום להפרשה — עם פירוט חומש
      React.createElement('div', { style: styles.card },
        React.createElement('p', { style: styles.cardLabel }, 'סכום להפרשה'),
        React.createElement('p', { style: { ...styles.cardValue, color: '#2563EB' } }, fmt(summary.target)),
        rate === 0.2 && React.createElement('div', { style: { marginTop: 6, borderTop: '1px solid #E2E8F0', paddingTop: 6 } },
          React.createElement('p', { style: styles.breakdown },
            `10% מעשר: ${fmt(summary.maaser10)}`
          ),
          React.createElement('p', { style: styles.breakdown },
            `10% השלמה לחומש: ${fmt(summary.chomesh10)}`
          ),
        ),
      ),

      KpiCard('הופרש עד כה', fmt(summary.paid), '#10B981', 'תרומות וצדקה'),

      // כרטיס יתרה — עם פירוט חומש
      React.createElement('div', {
        style: { ...styles.card, borderColor: summary.balance > 0 ? '#FCA5A5' : '#BBF7D0' }
      },
        React.createElement('p', { style: styles.cardLabel }, 'נותר להפריש'),
        React.createElement('p', {
          style: { ...styles.cardValue, color: summary.balance > 0 ? '#E11D48' : '#10B981' }
        }, fmt(Math.abs(summary.balance))),
        rate === 0.2
          ? React.createElement('div', { style: { marginTop: 6, borderTop: '1px solid #E2E8F0', paddingTop: 6 } },
              React.createElement('p', { style: { ...styles.breakdown, color: summary.paid10 >= summary.maaser10 ? '#10B981' : '#E11D48' } },
                `מעשר: ${summary.paid10 >= summary.maaser10 ? '✓ שולם' : `חסר ${fmt(summary.maaser10 - summary.paid10)}`}`
              ),
              React.createElement('p', { style: { ...styles.breakdown, color: summary.paid20 >= summary.chomesh10 ? '#10B981' : '#F59E0B' } },
                `חומש: ${summary.paid20 >= summary.chomesh10 ? '✓ שולם' : `חסר ${fmt(summary.chomesh10 - summary.paid20)}`}`
              ),
            )
          : React.createElement('p', { style: { fontSize: 11, color: '#94A3B8' } },
              `שולם: ${fmt(summary.paid)}`
            ),
      ),
    ),

    // פס התקדמות
    summary.target > 0 && React.createElement('div', { style: styles.progressWrap },
      React.createElement('div', { style: styles.progressHeader },
        React.createElement('span', { style: { fontSize: 13, color: '#475569' } }, 'התקדמות תשלום'),
        React.createElement('span', { style: { fontSize: 13, fontWeight: '600' } },
          `${Math.min(100, Math.round((summary.paid / summary.target) * 100))}%`
        ),
      ),
      React.createElement('div', { style: styles.progressBar },
        React.createElement('div', {
          style: {
            ...styles.progressFill,
            width: `${Math.min(100, (summary.paid / summary.target) * 100)}%`,
            backgroundColor: summary.paid >= summary.target ? '#10B981' : '#2563EB',
          }
        })
      ),
    ),

    // טבלת תנועות — כולן
    React.createElement('div', { style: styles.tableWrap },
      React.createElement('div', { style: styles.tableHeader },
        React.createElement('p', { style: { fontSize: 14, fontWeight: '600', color: '#0F172A', margin: 0 } }, 'כל התנועות'),
        React.createElement('p', { style: { fontSize: 12, color: '#94A3B8', margin: 0 } }, 'לחץ על הסטטוס לשינוי'),
      ),
      transactions.length === 0
        ? React.createElement('div', { style: styles.empty }, '🕍 אין תנועות לתקופה זו')
        : React.createElement('table', { style: styles.table },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['תאריך', 'בית עסק', 'קטגוריה', 'סכום', 'סטטוס מעשר', 'השפעה'].map(h =>
                  React.createElement('th', { key: h, style: styles.th }, h)
                )
              )
            ),
            React.createElement('tbody', null,
              transactions.map(tx => {
                const isDonation = tx.category_id === DONATION_CATEGORY_ID
                const impact = getImpact(tx)

                // צבע רקע לפי סוג
                let rowBg = '#fff'
                if (isDonation) rowBg = '#F0FDF4'
                else if (tx.transaction_type === 'Expense' && !tx.is_maaser_obligated && !isDonation) rowBg = '#FFFBEB'
                else if (tx.transaction_type === 'Income' && !tx.is_maaser_obligated) rowBg = '#F8FAFC'

                return React.createElement('tr', { key: tx.id, style: { ...styles.tr, backgroundColor: rowBg } },
                  React.createElement('td', { style: styles.td }, tx.transaction_date),
                  React.createElement('td', { style: { ...styles.td, fontWeight: '500' } }, tx.business_entity || '—'),
                  React.createElement('td', { style: styles.td },
                    React.createElement('span', { style: styles.badge }, tx.category_name || '—')
                  ),
                  React.createElement('td', { style: styles.td },
                    React.createElement('span', {
                      style: { color: tx.transaction_type === 'Income' ? '#10B981' : '#E11D48', fontWeight: '500' }
                    }, `${tx.transaction_type === 'Income' ? '+' : '−'}${fmt(tx.amount)}`)
                  ),
                  // כפתור סטטוס
                  React.createElement('td', { style: styles.td },
                    isDonation
                      ? React.createElement('span', { style: { ...styles.statusBadge, backgroundColor: '#D1FAE5', color: '#065F46' } }, '🕍 תרומה')
                      : React.createElement('button', {
                          style: {
                            ...styles.statusBtn,
                            backgroundColor: tx.is_maaser_obligated ? '#FEE2E2' : '#F1F5F9',
                            color: tx.is_maaser_obligated ? '#991B1B' : '#475569',
                            opacity: saving === tx.id ? 0.5 : 1,
                          },
                          disabled: saving === tx.id,
                          onClick: () => toggleMaaserStatus(tx),
                        },
                        tx.is_maaser_obligated ? '⚡ חייב' : '✓ פטור'
                      )
                  ),
                  React.createElement('td', { style: { ...styles.td, fontWeight: '600', color: impact.color, fontSize: 12 } },
                    impact.text
                  ),
                )
              })
            )
          )
    ),
  )
}

function KpiCard(label, value, color, sub) {
  return React.createElement('div', { style: styles.card },
    React.createElement('p', { style: styles.cardLabel }, label),
    React.createElement('p', { style: { ...styles.cardValue, color } }, value),
    sub && React.createElement('p', { style: { fontSize: 11, color: '#94A3B8' } }, sub),
  )
}

const styles = {
  page: { padding: 28 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  headerLeft: { display: 'flex', gap: 10, alignItems: 'center' },
  select: { border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 12px', fontSize: 13, outline: 'none' },
  toggle: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' },
  toggleBtn: { padding: '7px 16px', border: 'none', backgroundColor: '#F8FAFC', fontSize: 13, cursor: 'pointer', color: '#475569' },
  toggleActive: { backgroundColor: '#2563EB', color: '#fff' },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 16 },
  grid5: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 18 },
  cardLabel: { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 },
  cardValue: { fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  breakdown: { fontSize: 11, color: '#64748B', margin: '2px 0' },
  progressWrap: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16, marginBottom: 16 },
  progressHeader: { display: 'flex', justifyContent: 'space-between', marginBottom: 8 },
  progressBar: { height: 10, backgroundColor: '#E2E8F0', borderRadius: 5, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 5, transition: 'width 0.4s' },
  tableWrap: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden' },
  tableHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'right', fontSize: 11, fontWeight: '600', color: '#64748B', padding: '10px 16px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' },
  tr: { borderBottom: '1px solid #F1F5F9' },
  td: { padding: '10px 16px', fontSize: 13, color: '#0F172A' },
  badge: { backgroundColor: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontSize: 11 },
  statusBadge: { padding: '3px 10px', borderRadius: 8, fontSize: 12, fontWeight: '500' },
  statusBtn: { padding: '4px 10px', borderRadius: 8, fontSize: 12, fontWeight: '500', border: 'none', cursor: 'pointer' },
  empty: { textAlign: 'center', padding: 40, color: '#94A3B8', fontSize: 14 },
}

module.exports = Maaser