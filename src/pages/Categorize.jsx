const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')

function Categorize() {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [filter, setFilter] = useState('uncategorized')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(null)

  function loadData() {
    const txs = db.prepare(`
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM Transactions t
      LEFT JOIN Categories c ON t.category_id = c.id
      LEFT JOIN Accounts a ON t.account_id = a.id
      ORDER BY t.transaction_date DESC, t.id DESC
    `).all()
    setTransactions(txs)
    setCategories(db.prepare('SELECT * FROM Categories WHERE is_active=1 ORDER BY sort_order').all())
  }

  useEffect(() => { loadData() }, [])

  function handleCategorize(txId, categoryId, businessEntity) {
    setSaving(txId)
    db.prepare('UPDATE Transactions SET category_id = ? WHERE id = ?').run(categoryId || null, txId)

    // למידה אוטומטית — שמור חוק לעתיד
    if (businessEntity && categoryId) {
      const existing = db.prepare(
        "SELECT id FROM Automation_Rules WHERE original_string = ? AND match_type != 'mapping'"
      ).get(businessEntity.toLowerCase())

      if (!existing) {
        db.prepare(`
          INSERT INTO Automation_Rules (original_string, cleaned_name, category_id, match_type, priority, use_count)
          VALUES (?, ?, ?, 'contains', 0, 1)
        `).run(businessEntity.toLowerCase(), businessEntity, categoryId)
      } else {
        db.prepare(
          'UPDATE Automation_Rules SET category_id = ?, use_count = use_count + 1 WHERE id = ?'
        ).run(categoryId, existing.id)
      }
    }

    setTransactions(prev =>
      prev.map(t => t.id === txId ? { ...t, category_id: categoryId } : t)
    )
    setSaving(null)
  }

  const filtered = transactions
    .filter(t => filter === 'all' || !t.category_id)
    .filter(t => !search ||
      (t.business_entity ?? '').toLowerCase().includes(search.toLowerCase())
    )

  const totalCount = transactions.length
  const uncategorizedCount = transactions.filter(t => !t.category_id).length
  const progress = totalCount > 0 ? Math.round(((totalCount - uncategorizedCount) / totalCount) * 100) : 0

  const fmt = n => '₪' + n.toLocaleString('he-IL')

  return React.createElement('div', { style: styles.page },

    // כותרת
    React.createElement('div', { style: styles.header },
      React.createElement('div', null,
        React.createElement('h1', { style: styles.title }, 'סיווג תנועות'),
        React.createElement('p', { style: styles.subtitle },
          `${uncategorizedCount} תנועות ממתינות לסיווג מתוך ${totalCount}`
        ),
      ),
      // פס התקדמות
      React.createElement('div', { style: { width: 200 } },
        React.createElement('div', { style: styles.progressRow },
          React.createElement('span', { style: styles.progressLabel }, 'התקדמות'),
          React.createElement('span', { style: styles.progressLabel }, `${progress}%`),
        ),
        React.createElement('div', { style: styles.progressBar },
          React.createElement('div', {
            style: { ...styles.progressFill, width: `${progress}%` }
          })
        ),
      ),
    ),

    // סינון וחיפוש
    React.createElement('div', { style: styles.toolbar },
      React.createElement('div', { style: styles.tabs },
        React.createElement('button', {
          style: { ...styles.tab, ...(filter === 'uncategorized' ? styles.tabActive : {}) },
          onClick: () => setFilter('uncategorized'),
        }, `ממתינות (${uncategorizedCount})`),
        React.createElement('button', {
          style: { ...styles.tab, ...(filter === 'all' ? styles.tabActive : {}) },
          onClick: () => setFilter('all'),
        }, `כולן (${totalCount})`),
      ),
      React.createElement('input', {
        style: styles.search,
        placeholder: 'חיפוש לפי שם עסק...',
        value: search,
        onChange: e => setSearch(e.target.value),
      }),
    ),

    // טבלה
    filtered.length === 0
      ? React.createElement('div', { style: styles.empty },
          React.createElement('p', { style: { fontSize: 40, marginBottom: 8 } }, '✅'),
          React.createElement('p', { style: { fontWeight: '600', color: '#475569' } },
            filter === 'uncategorized' ? 'כל התנועות מסווגות!' : 'לא נמצאו תנועות'
          ),
        )
      : React.createElement('div', { style: styles.tableWrap },
          React.createElement('table', { style: styles.table },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['תאריך', 'חשבון', 'בית עסק', 'סכום', 'קטגוריה'].map(h =>
                  React.createElement('th', { key: h, style: styles.th }, h)
                )
              )
            ),
            React.createElement('tbody', null,
              filtered.map(tx => {
                const relevantCats = categories.filter(c =>
                  tx.transaction_type === 'Income' ? c.type === 'Income' : c.type === 'Expense'
                )
                return React.createElement('tr', {
                  key: tx.id,
                  style: {
                    ...styles.tr,
                    backgroundColor: !tx.category_id ? '#FFFBEB' : '#fff',
                  }
                },
                  React.createElement('td', { style: styles.td }, tx.transaction_date),
                  React.createElement('td', { style: { ...styles.td, color: '#64748B', fontSize: 12 } }, tx.account_name || '—'),
                  React.createElement('td', { style: { ...styles.td, fontWeight: '500' } }, tx.business_entity || '—'),
                  React.createElement('td', { style: { ...styles.td } },
                    React.createElement('span', {
                      style: { fontWeight: '600', color: tx.transaction_type === 'Income' ? '#10B981' : '#E11D48' }
                    }, `${tx.transaction_type === 'Income' ? '+' : '−'}${fmt(tx.amount)}`)
                  ),
                  React.createElement('td', { style: { ...styles.td, minWidth: 180 } },
                    React.createElement('select', {
                      style: {
                        ...styles.catSelect,
                        borderColor: tx.category_id ? '#BBF7D0' : '#FDE68A',
                        backgroundColor: tx.category_id ? '#F0FDF4' : '#FFFBEB',
                        color: tx.category_id ? '#15803D' : '#92400E',
                        opacity: saving === tx.id ? 0.5 : 1,
                      },
                      value: tx.category_id || '',
                      disabled: saving === tx.id,
                      onChange: e => handleCategorize(tx.id, e.target.value ? parseInt(e.target.value) : null, tx.business_entity),
                    },
                      React.createElement('option', { value: '' }, 'בחר קטגוריה...'),
                      relevantCats.map(c =>
                        React.createElement('option', { key: c.id, value: c.id }, `${c.icon || ''} ${c.name}`)
                      )
                    )
                  ),
                )
              })
            )
          )
        )
  )
}

const styles = {
  page: { padding: 28 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#64748B' },
  progressRow: { display: 'flex', justifyContent: 'space-between', marginBottom: 4 },
  progressLabel: { fontSize: 11, color: '#64748B' },
  progressBar: { height: 8, backgroundColor: '#E2E8F0', borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#10B981', borderRadius: 4, transition: 'width 0.3s' },
  toolbar: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 },
  tabs: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' },
  tab: { padding: '7px 16px', border: 'none', backgroundColor: '#F8FAFC', fontSize: 13, cursor: 'pointer', color: '#475569' },
  tabActive: { backgroundColor: '#2563EB', color: '#fff' },
  search: { border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 12px', fontSize: 13, outline: 'none', width: 240 },
  tableWrap: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'right', fontSize: 11, fontWeight: '600', color: '#64748B', padding: '10px 14px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', whiteSpace: 'nowrap' },
  tr: { borderBottom: '1px solid #F1F5F9' },
  td: { padding: '10px 14px', fontSize: 13, color: '#0F172A' },
  catSelect: { width: '100%', border: '1px solid', borderRadius: 8, padding: '5px 8px', fontSize: 12, outline: 'none', cursor: 'pointer' },
  empty: { textAlign: 'center', padding: 60, color: '#94A3B8' },
}

module.exports = Categorize