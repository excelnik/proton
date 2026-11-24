const React = require('react')
const { useState, useEffect, useCallback } = React
const db = require('../db/index.js')
const { recurringMonthlyBudgetAmount, adjustPlanForRecurringImports } = require('../lib/budgetUtils.js')
const { getDateColumn } = require('../db/index.js')

function Budget({ selectedMonth, setSelectedMonth }) {
  const [budgetRows, setBudgetRows] = useState([])
  const [categories, setCategories] = useState([])
  const debounceTimers = React.useRef({})

  // רשימת חודשים — 12 אחורה + 12 קדימה
    const months = React.useMemo(() => {
    const dateCol = getDateColumn()
    const rows = db.prepare(`
        SELECT DISTINCT substr(${dateCol}, 1, 7) as month
        FROM Transactions
        WHERE ${dateCol} IS NOT NULL AND ${dateCol} != ''
        ORDER BY month DESC
    `).all()
    const fromDB = rows
        .map(r => r.month)
        .filter(m => !!new Date(m + '-01').getMonth || new Date(m + '-01').toString() !== 'Invalid Date')

    // הוסף 12 חודשים קדימה לתכנון עתידי
    const future = Array.from({ length: 12 }, (_, i) => {
        const d = new Date()
        d.setMonth(d.getMonth() + i + 1)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    })

    const all = [...new Set([...future, ...fromDB])].sort((a, b) => b.localeCompare(a))

    return all.map(m => ({
        val: m,
        label: new Date(m + '-01').toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
    })).filter(r => r.label !== 'Invalid Date')
    }, [])

  function loadBudget() {
    const dateCol = getDateColumn()
    const cats = db.prepare(`
      SELECT * FROM Categories WHERE is_active=1 AND parent_id IS NULL
      ORDER BY type DESC, sort_order
    `).all()

    const rows = cats.map(cat => {
      const planned = db.prepare(`
        SELECT planned_amount FROM Budget_Goals
        WHERE category_id=? AND budget_period=?
      `).get(cat.id, `${selectedMonth}-01`)?.planned_amount ?? 0

      // ממוצע שלושת החודשים המלאים שקדמו לחודש המתוכנן.
      const monthStart = new Date(`${selectedMonth}-01T00:00:00`)
      const fromDate = new Date(monthStart.getFullYear(), monthStart.getMonth() - 3, 1)
      const toDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), 0)
      const from3 = `${fromDate.getFullYear()}-${String(fromDate.getMonth() + 1).padStart(2, '0')}-01`
      const to3 = `${toDate.getFullYear()}-${String(toDate.getMonth() + 1).padStart(2, '0')}-${String(toDate.getDate()).padStart(2, '0')}`

      const avg3 = db.prepare(`
        SELECT COALESCE(SUM(amount) / 3.0, 0) as avg
        FROM Transactions
        WHERE category_id=? AND ${dateCol} BETWEEN ? AND ? AND is_budgetary=1
      `).get(cat.id, from3, to3)?.avg ?? 0

      // בפועל החודש הנוכחי
      const actual = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as v
        FROM Transactions
        WHERE category_id=? AND ${dateCol} LIKE ? AND is_budgetary=1
      `).get(cat.id, `${selectedMonth}%`)?.v ?? 0

      return { ...cat, planned, avg3, actual }
    })

    setCategories(cats)
    setBudgetRows(rows)
  }

  function handleImportRecurring() {
    const templates = db.prepare(`
      SELECT id, amount, frequency, season_months, category_id, minimum_commitment
      FROM Recurring_Templates
      WHERE is_active=1 AND type='recurring' AND category_id IS NOT NULL
    `).all()

    const monthlyAmount = recurringMonthlyBudgetAmount

    const imports = templates.map(template => ({
      ...template, monthly_amount: monthlyAmount(template),
    })).filter(template => template.monthly_amount > 0)

    const period = `${selectedMonth}-01`
    const previousCount = db.prepare('SELECT COUNT(*) AS count FROM Budget_Recurring_Imports WHERE budget_period=?').get(period)?.count || 0
    if (!imports.length && !previousCount) {
      alert('אין הוראות קבע פעילות עם קטגוריה וסכום שניתן לייבא לתקציב.')
      return
    }
    const prompt = imports.length
      ? `לעדכן בתקציב ${imports.length} הוראות קבע לחודש הנבחר? סכום חודשי יחושב לפי התדירות; תשלום שנתי יחולק ל-12 ותשלום עונתי לפי חודשי העונה. ייבוא חוזר לא יוסיף סכומים פעמיים.`
      : 'לא נותרו הוראות קבע לייבוא. להסיר מהתקציב את רכיבי ההוראות שיובאו בעבר?'
    if (!confirm(prompt)) return
    const apply = db.transaction(() => {
      const previous = db.prepare(`
        SELECT category_id, SUM(monthly_amount) AS total
        FROM Budget_Recurring_Imports WHERE budget_period=? GROUP BY category_id
      `).all(period)
      const oldTotals = new Map(previous.map(row => [row.category_id, Number(row.total) || 0]))
      const newTotals = new Map()
      for (const item of imports) {
        newTotals.set(item.category_id, (newTotals.get(item.category_id) || 0) + item.monthly_amount)
      }

      const categoryIds = new Set([...oldTotals.keys(), ...newTotals.keys()])
      const readPlan = db.prepare('SELECT planned_amount FROM Budget_Goals WHERE category_id=? AND budget_period=?')
      const savePlan = db.prepare(`
        INSERT INTO Budget_Goals (category_id, budget_period, planned_amount)
        VALUES (?, ?, ?)
        ON CONFLICT(category_id, budget_period) DO UPDATE SET planned_amount=excluded.planned_amount
      `)
      for (const categoryId of categoryIds) {
        const planned = Number(readPlan.get(categoryId, period)?.planned_amount) || 0
        const next = adjustPlanForRecurringImports(planned, oldTotals.get(categoryId), newTotals.get(categoryId))
        savePlan.run(categoryId, period, next)
      }

      db.prepare('DELETE FROM Budget_Recurring_Imports WHERE budget_period=?').run(period)
      const saveImport = db.prepare(`
        INSERT INTO Budget_Recurring_Imports (budget_period, recurring_id, category_id, monthly_amount)
        VALUES (?, ?, ?, ?)
      `)
      imports.forEach(item => saveImport.run(period, item.id, item.category_id, item.monthly_amount))
    })
    apply()
    loadBudget()
    alert('הוראות הקבע עודכנו בתקציב החודשי. ניתן לערוך את הסכום המתוכנן כרגיל.')
  }

  useEffect(() => { loadBudget() }, [selectedMonth])

  // Auto-save עם debounce 1.5 שניות
  function handlePlannedChange(categoryId, value) {
    // עדכון מיידי ב-UI
    setBudgetRows(prev => prev.map(r =>
      r.id === categoryId ? { ...r, planned: parseFloat(value) || 0 } : r
    ))

    // debounce לשמירה ב-DB
    if (debounceTimers.current[categoryId]) {
      clearTimeout(debounceTimers.current[categoryId])
    }
    debounceTimers.current[categoryId] = setTimeout(() => {
      db.prepare(`
        INSERT OR REPLACE INTO Budget_Goals (category_id, budget_period, planned_amount)
        VALUES (?, ?, ?)
      `).run(categoryId, `${selectedMonth}-01`, parseFloat(value) || 0)
    }, 1500)
  }

  function handleDuplicate() {
    if (!confirm(`פעולה זו תדרוס את כל התכנון הקיים לחודש זה. האם להמשיך?`)) return
    const d = new Date(`${selectedMonth}-01`)
    d.setMonth(d.getMonth() - 1)
    const prevMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

    db.prepare('DELETE FROM Budget_Goals WHERE budget_period=?').run(`${selectedMonth}-01`)
    db.prepare(`
      INSERT INTO Budget_Goals (category_id, budget_period, planned_amount)
      SELECT category_id, ?, planned_amount FROM Budget_Goals WHERE budget_period=?
    `).run(`${selectedMonth}-01`, prevMonth)
    loadBudget()
  }

  function handleClear() {
    if (!confirm('האם אתה בטוח שברצונך לאפס את התקציב לחודש זה?')) return
    db.prepare('DELETE FROM Budget_Goals WHERE budget_period=?').run(`${selectedMonth}-01`)
    loadBudget()
  }

  const incomeRows  = budgetRows.filter(r => r.type === 'Income')
  const expenseRows = budgetRows.filter(r => r.type === 'Expense')
  const totalIncome  = incomeRows.reduce((s, r) => s + r.planned, 0)
  const totalExpense = expenseRows.reduce((s, r) => s + r.planned, 0)
  const remaining = totalIncome - totalExpense

  const fmt = n => '₪' + Math.abs(n).toLocaleString('he-IL')

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'תכנון תקציב'),
      React.createElement('div', { style: styles.headerLeft },
        React.createElement('button', { style: styles.btnAction, onClick: handleDuplicate, title: 'שכפל מחודש קודם' }, '📋 שכפל'),
        React.createElement('button', { style: styles.btnAction, title: 'ייבא תנועות קבועות', onClick: handleImportRecurring }, '🧲 ייבא קבועות'),
        React.createElement('button', { style: { ...styles.btnAction, color: '#E11D48' }, onClick: handleClear, title: 'נקה הכל' }, '🗑 נקה הכל'),
        React.createElement('select', {
          style: styles.monthSelect,
          value: selectedMonth,
          onChange: e => setSelectedMonth(e.target.value),
        }, months.map(m => React.createElement('option', { key: m.val, value: m.val }, m.label)))
      )
    ),

    // Budget Overview Widget
    React.createElement('div', { style: styles.overviewCard },
      React.createElement('div', { style: styles.overviewSection },
        React.createElement('p', { style: styles.overviewLabel }, 'הכנסות צפויות'),
        React.createElement('p', { style: { ...styles.overviewValue, color: '#10B981' } }, fmt(totalIncome)),
      ),
      React.createElement('div', { style: { ...styles.overviewSection, borderRight: '1px solid #E2E8F0', borderLeft: '1px solid #E2E8F0' } },
        React.createElement('p', { style: styles.overviewLabel }, 'הוצאות מתוכננות'),
        React.createElement('p', { style: { ...styles.overviewValue, color: '#E11D48' } }, fmt(totalExpense)),
      ),
      React.createElement('div', { style: styles.overviewSection },
        React.createElement('p', { style: styles.overviewLabel }, 'נותר לתקצוב'),
        React.createElement('p', {
          style: {
            ...styles.overviewValue,
            color: remaining > 0 ? '#10B981' : remaining < 0 ? '#E11D48' : '#2563EB',
          }
        }, fmt(remaining)),
        React.createElement('p', {
          style: {
            fontSize: 12,
            color: remaining > 0 ? '#10B981' : remaining < 0 ? '#E11D48' : '#2563EB',
            marginTop: 4,
          }
        },
          remaining > 0 ? `נותרו לך ${fmt(remaining)} להקצות` :
          remaining < 0 ? `חריגה בתכנון! ${fmt(remaining)} יותר ממה שייכנס` :
          '✓ תקציב מאוזן מושלם!'
        ),
      ),
    ),

    // Budget Grid — שתי עמודות
    React.createElement('div', { style: styles.grid },
      // הכנסות
      BudgetColumn('הכנסות', incomeRows, handlePlannedChange, fmt),
      // הוצאות
      BudgetColumn('הוצאות', expenseRows, handlePlannedChange, fmt),
    ),
  )
}

function BudgetColumn(title, rows, onChange, fmt) {
  return React.createElement('div', { style: styles.column },
    React.createElement('div', { style: styles.columnHeader },
      React.createElement('span', { style: styles.columnTitle }, title),
      React.createElement('span', { style: styles.columnTotal },
        fmt(rows.reduce((s, r) => s + r.planned, 0))
      ),
    ),
    React.createElement('div', { style: styles.columnBody },
      rows.length === 0
        ? React.createElement('p', { style: { color: '#94A3B8', fontSize: 13, padding: 16 } }, 'אין קטגוריות')
        : rows.map(row =>
            React.createElement('div', { key: row.id, style: styles.budgetRow },
              React.createElement('div', { style: styles.budgetRowRight },
                React.createElement('span', { style: { fontSize: 16 } }, row.icon || '📁'),
                React.createElement('span', { style: styles.catName }, row.name),
              ),
              React.createElement('div', { style: styles.budgetRowLeft },
                React.createElement('input', {
                  type: 'number',
                  style: styles.plannedInput,
                  value: row.planned || '',
                  placeholder: '0',
                  onChange: e => onChange(row.id, e.target.value),
                }),
                row.avg3 > 0 && React.createElement('p', { style: styles.hint },
                  `ממוצע 3 חודשים: ${fmt(row.avg3)}`
                ),
                row.actual > 0 && React.createElement('p', { style: { ...styles.hint, color: row.actual > row.planned && row.planned > 0 ? '#E11D48' : '#64748B' } },
                  `בפועל: ${fmt(row.actual)}`
                ),
                row.planned > 0 && React.createElement('p', { style: { ...styles.hint, color: row.actual > row.planned ? '#E11D48' : '#64748B', fontWeight: '600' } },
                  `ניצול תקציב: ${Math.round((row.actual / row.planned) * 100)}%`
                ),
              ),
            )
          )
    ),
  )
}

const styles = {
  page: { padding: 28 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  headerLeft: { display: 'flex', gap: 8, alignItems: 'center' },
  btnAction: { backgroundColor: '#F8FAFC', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer', color: '#475569' },
  monthSelect: { border: '1px solid #E2E8F0', borderRadius: 10, padding: '6px 12px', fontSize: 13, outline: 'none' },
  overviewCard: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', marginBottom: 20, overflow: 'hidden' },
  overviewSection: { padding: 20, textAlign: 'center' },
  overviewLabel: { fontSize: 12, color: '#64748B', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' },
  overviewValue: { fontSize: 26, fontWeight: 'bold' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  column: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' },
  columnHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' },
  columnTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A' },
  columnTotal: { fontSize: 14, fontWeight: '600', color: '#2563EB' },
  columnBody: { padding: '8px 0' },
  budgetRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '10px 18px', borderBottom: '1px solid #F8FAFC' },
  budgetRowRight: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 },
  budgetRowLeft: { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2 },
  catName: { fontSize: 13, fontWeight: '500', color: '#0F172A' },
  plannedInput: { width: 110, border: '1px solid #E2E8F0', borderRadius: 8, padding: '5px 10px', fontSize: 13, textAlign: 'left', outline: 'none', direction: 'ltr' },
  hint: { fontSize: 10, color: '#94A3B8', margin: 0 },
}

module.exports = Budget