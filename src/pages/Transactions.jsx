const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')
const { getDateColumn } = require('../db/index.js')

function generateVirtualTransactions() {
  const virtual = []

  // ─── תנועות וירטואליות מהלוואות ───
  const loans = db.prepare('SELECT * FROM Liabilities WHERE is_active=1').all()
  for (const loan of loans) {
    const monthlyRate = loan.interest_rate / 100 / 12
    const activeDuration = loan.duration_months - (loan.grace_period_months || 0)
    const pmt = monthlyRate === 0
      ? loan.total_amount / activeDuration
      : (loan.total_amount * monthlyRate * Math.pow(1 + monthlyRate, activeDuration)) /
        (Math.pow(1 + monthlyRate, activeDuration) - 1)

    let balance = loan.total_amount
    const startDate = new Date(loan.first_payment_date)

    for (let i = 0; i < loan.duration_months; i++) {
      const date = new Date(startDate)
      date.setMonth(date.getMonth() + i)
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const monthStr = dateStr.slice(0, 7)

      const isGrace = i < (loan.grace_period_months || 0)
      const interestPayment = balance * monthlyRate
      const principalPayment = isGrace ? 0 : pmt - interestPayment
      const monthlyPayment = isGrace
        ? (loan.grace_type === 'partial' ? interestPayment : 0)
        : pmt

      balance = Math.max(0, balance - principalPayment)

      const covered = db.prepare(`
        SELECT id FROM Transactions
        WHERE liability_id=? AND substr(transaction_date,1,7)=?
      `).get(loan.id, monthStr)

      if (!covered && monthlyPayment > 0) {
        virtual.push({
          id: `virtual_loan_${loan.id}_${i}`,
          transaction_date: dateStr,
          amount: Math.round(monthlyPayment),
          transaction_type: 'Expense',
          business_entity: loan.name,
          category_name: 'החזר הלוואה',
          account_id: loan.account_id,
          liability_id: loan.id,
          is_virtual: true,
          is_budgetary: 0,
          description: `תשלום ${i + 1} מתוך ${loan.duration_months}`,
          virtual_source: 'loan',
        })
      }
    }
  }

  // ─── תנועות וירטואליות מהוראות קבע ───
  try {
    const templates = db.prepare("SELECT * FROM Recurring_Templates WHERE is_active=1 AND type='recurring'").all()
    const today = new Date()

    for (const t of templates) {
      // צור תנועות ל-12 חודשים קדימה
      for (let i = 0; i < 12; i++) {
        const date = new Date(today.getFullYear(), today.getMonth() + i, t.charge_day || 1)
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        const monthStr = dateStr.slice(0, 7)

        // בדוק אם כבר יש תנועה אמיתית מהתבנית לחודש הזה
        const covered = db.prepare(`
          SELECT id FROM Transactions
          WHERE recurring_id=? AND substr(transaction_date,1,7)=?
        `).get(t.id, monthStr)

        if (!covered) {
          virtual.push({
            id: `virtual_recurring_${t.id}_${i}`,
            transaction_date: dateStr,
            amount: t.amount,
            transaction_type: 'Expense',
            business_entity: t.name,
            category_id: t.category_id,
            category_name: null,
            account_id: t.account_id,
            recurring_id: t.id,
            is_virtual: true,
            is_budgetary: t.is_budgetary,
            description: t.notes || null,
            virtual_source: 'recurring',
          })
        }
      }
    }

    // ─── תנועות וירטואליות מעסקאות תשלומים ───
    const installments = db.prepare("SELECT * FROM Recurring_Templates WHERE is_active=1 AND type='installment'").all()

    for (const t of installments) {
      const paid = t.installments_paid || 0
      const remaining = t.num_installments - paid
      const startDate = new Date(t.first_charge_date || today)

      for (let i = 0; i < remaining; i++) {
        const date = new Date(startDate)
        date.setMonth(date.getMonth() + paid + i)
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
        const monthStr = dateStr.slice(0, 7)

        const covered = db.prepare(`
          SELECT id FROM Transactions
          WHERE recurring_id=? AND substr(transaction_date,1,7)=?
        `).get(t.id, monthStr)

        if (!covered) {
          virtual.push({
            id: `virtual_installment_${t.id}_${i}`,
            transaction_date: dateStr,
            amount: t.amount,
            transaction_type: 'Expense',
            business_entity: t.name,
            category_id: t.category_id,
            category_name: null,
            account_id: t.account_id,
            recurring_id: t.id,
            is_virtual: true,
            is_budgetary: t.is_budgetary,
            description: `תשלום ${paid + i + 1} מתוך ${t.num_installments}`,
            virtual_source: 'installment',
          })
        }
      }
    }
  } catch(e) {}

  return virtual
}

function Transactions({ selectedMonth, setSelectedMonth }) {
  const [transactions, setTransactions] = useState([])
  const [categories, setCategories] = useState([])
  const [accounts, setAccounts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [expandedTx, setExpandedTx] = useState(null)
  const [editingTx, setEditingTx] = useState(null) // עריכה inline מהירה
  const [editingFull, setEditingFull] = useState(null) // עריכה מלאה באקורדיון
  const [editForm, setEditForm] = useState({})
  const [duplicateTx, setDuplicateTx] = useState(null)
  const [splitTx, setSplitTx] = useState(null)
  const [offsetTx, setOffsetTx] = useState(null)

  function startEdit(tx) {
    setEditingTx(tx.id)
    setEditForm({
      transaction_date: tx.transaction_date,
      amount: tx.amount.toString(),
      business_entity: tx.business_entity || '',
      category_id: tx.category_id?.toString() ?? '',
      account_id: tx.account_id?.toString() ?? '',
    })
  }

  function startFullEdit(tx) {
    setEditingFull(tx.id)
    setEditForm({
      transaction_date: tx.transaction_date,
      value_date: tx.value_date || '',
      amount: tx.amount.toString(),
      business_entity: tx.business_entity || '',
      category_id: tx.category_id?.toString() ?? '',
      account_id: tx.account_id?.toString() ?? '',
      description: tx.description || '',
      tags: tx.tags || '',
      is_budgetary: tx.is_budgetary ? true : false,
      is_maaser_obligated: tx.is_maaser_obligated ? true : false,
      liability_id: tx.liability_id?.toString() ?? '',
      recurring_id: tx.recurring_id?.toString() ?? '',
      savings_goal_id: tx.savings_goal_id?.toString() ?? '',
      insurance_id: tx.insurance_id?.toString() ?? '',
    })
  }

  function saveEdit(txId) {
    db.prepare(`
      UPDATE Transactions SET
        transaction_date=?, amount=?, business_entity=?,
        category_id=?, account_id=?
      WHERE id=?
    `).run(
      editForm.transaction_date, parseFloat(editForm.amount),
      editForm.business_entity, editForm.category_id || null,
      editForm.account_id, txId
    )
    setEditingTx(null)
    loadData()
  }

  function saveFullEdit(txId) {
    db.prepare(`
      UPDATE Transactions SET
        transaction_date=?, value_date=?, amount=?, business_entity=?,
        category_id=?, account_id=?, description=?, tags=?,
        is_budgetary=?, is_maaser_obligated=?,
        liability_id=?, recurring_id=?, savings_goal_id=?, insurance_id=?
      WHERE id=?
    `).run(
      editForm.transaction_date, editForm.value_date || null,
      parseFloat(editForm.amount), editForm.business_entity,
      editForm.category_id || null, editForm.account_id,
      editForm.description || null, editForm.tags || null,
      editForm.is_budgetary ? 1 : 0, editForm.is_maaser_obligated ? 1 : 0,
      editForm.liability_id || null, editForm.recurring_id || null,
      editForm.savings_goal_id || null, editForm.insurance_id || null,
      txId
    )
    setEditingFull(null)
    setExpandedTx(null)
    loadData()
  }

  const setEdit = (k, v) => setEditForm(f => ({ ...f, [k]: v }))

  function loadData() {
    const dateCol = getDateColumn()
    const [year, month] = selectedMonth.split('-')
    const from = `${year}-${month}-01`
    const lastDay = new Date(year, month, 0).getDate()
    const to = `${year}-${month}-${lastDay}`

    const txs = db.prepare(`
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM Transactions t
      LEFT JOIN Categories c ON t.category_id = c.id
      LEFT JOIN Accounts a ON t.account_id = a.id
      WHERE t.${dateCol} BETWEEN ? AND ?
      ORDER BY t.transaction_date DESC, t.id DESC
    `).all(from, to)

    // הוסף תנועות וירטואליות של החודש הנוכחי
    const virtual = generateVirtualTransactions().filter(v =>
      v.transaction_date.slice(0, 7) === selectedMonth
    )
    // הוסף שם חשבון לוירטואליות
    const accounts = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
    virtual.forEach(v => {
      const acc = accounts.find(a => a.id === v.account_id)
      v.account_name = acc?.name ?? '—'
    })

    setTransactions([...txs, ...virtual])
    setCategories(db.prepare('SELECT * FROM Categories WHERE is_active=1 ORDER BY sort_order').all())
    setAccounts(db.prepare('SELECT * FROM Accounts WHERE is_active=1').all())
  }

  useEffect(() => { loadData() }, [selectedMonth])

  function handleConfirmVirtual(tx) {
    db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
        description, category_id, account_id, liability_id, recurring_id,
        is_budgetary, is_maaser_obligated, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'manual')
    `).run(
      tx.transaction_date, tx.transaction_date,
      tx.amount, tx.transaction_type, tx.business_entity,
      tx.description, tx.category_id, tx.account_id,
      tx.liability_id || null, tx.recurring_id || null,
      tx.is_budgetary ? 1 : 0
    )

    // אם זה תשלום — עדכן מונה
    if (tx.virtual_source === 'installment' && tx.recurring_id) {
      db.prepare('UPDATE Recurring_Templates SET installments_paid = installments_paid + 1 WHERE id=?')
        .run(tx.recurring_id)
    }

    loadData()
  }

  function handleDelete(id) {
    if (!confirm('למחוק תנועה זו?')) return
    db.prepare('DELETE FROM Transactions WHERE id=?').run(id)
    loadData()
  }

  const fmt = n => '₪' + n.toLocaleString('he-IL')
  const income  = transactions.filter(t => t.transaction_type === 'Income').reduce((s, t) => s + t.amount, 0)
  const expense = transactions.filter(t => t.transaction_type === 'Expense').reduce((s, t) => s + t.amount, 0)

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
      React.createElement('h1', { style: styles.title }, 'תנועות'),
      React.createElement('div', { style: styles.headerActions },
        React.createElement('select', {
          style: styles.select,
          value: selectedMonth,
          onChange: e => setSelectedMonth(e.target.value),
        }, months.map(m => React.createElement('option', { key: m.val, value: m.val }, m.label))),
        React.createElement('button', { style: styles.btnPrimary, onClick: () => setShowModal(true) }, '+ תנועה חדשה'),
      )
    ),

    // סיכום
    React.createElement('div', { style: styles.summaryRow },
      SummaryCard('הכנסות', fmt(income), '#10B981'),
      SummaryCard('הוצאות', fmt(expense), '#E11D48'),
      SummaryCard('יתרה', fmt(income - expense), income - expense >= 0 ? '#2563EB' : '#E11D48'),
    ),

    // טבלה
    React.createElement('div', { style: styles.tableWrap },
      transactions.length === 0
        ? React.createElement('div', { style: styles.empty },
            React.createElement('p', null, '💸'),
            React.createElement('p', null, 'אין תנועות לחודש זה'),
          )
        : React.createElement('table', { style: styles.table },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['תאריך', 'בית עסק', 'קטגוריה', 'חשבון', 'סכום', '', ''].map(h =>
                  React.createElement('th', { key: h, style: styles.th }, h)
                )
              )
            ),
            React.createElement('tbody', null,
              transactions.map(tx => {
                const isExpanded = expandedTx === tx.id
                const isEditing = editingTx === tx.id
                const isEditingFull = editingFull === tx.id

                // טען נתוני אקורדיון רק כשמורחב
                let expandedData = null
                if (isExpanded || isEditingFull) {
                  const loan = tx.liability_id
                    ? db.prepare('SELECT name FROM Liabilities WHERE id=?').get(tx.liability_id)
                    : null
                  const recurring = tx.recurring_id
                    ? db.prepare('SELECT name, type FROM Recurring_Templates WHERE id=?').get(tx.recurring_id)
                    : null
                  const savingsGoal = tx.savings_goal_id
                    ? db.prepare('SELECT name FROM Savings_Goals WHERE id=?').get(tx.savings_goal_id)
                    : null
                  const insurance = tx.insurance_id
                    ? db.prepare('SELECT name FROM Insurance_Policies WHERE id=?').get(tx.insurance_id)
                    : null
                  const parent = tx.parent_id
                    ? db.prepare('SELECT id, business_entity, amount FROM Transactions WHERE id=?').get(tx.parent_id)
                    : null
                  const children = db.prepare('SELECT id, business_entity, amount FROM Transactions WHERE parent_id=?').all(tx.id)
                  const offsetGroup = tx.offset_group_id
                    ? db.prepare('SELECT id, business_entity, amount FROM Transactions WHERE offset_group_id=? AND id!=?').all(tx.offset_group_id, tx.id)
                    : []
                  expandedData = { loan, recurring, savingsGoal, insurance, parent, children, offsetGroup }
                }

                // שורה במצב עריכה inline מהירה
                if (isEditing) {
                  const filteredCats = categories.filter(c =>
                    tx.transaction_type === 'Income' ? c.type === 'Income' : c.type === 'Expense'
                  )
                  return React.createElement(React.Fragment, { key: tx.id },
                    React.createElement('tr', { style: { ...styles.tr, backgroundColor: '#FFFBEB' } },
                      React.createElement('td', { style: styles.td },
                        React.createElement('input', {
                          style: { ...inlineInput, width: 110 },
                          type: 'date', value: editForm.transaction_date,
                          onChange: e => setEdit('transaction_date', e.target.value),
                        })
                      ),
                      React.createElement('td', { style: styles.td },
                        React.createElement('input', {
                          style: inlineInput,
                          value: editForm.business_entity,
                          onChange: e => setEdit('business_entity', e.target.value),
                          onKeyDown: e => e.key === 'Enter' && saveEdit(tx.id),
                        })
                      ),
                      React.createElement('td', { style: styles.td },
                        React.createElement('select', {
                          style: { ...inlineInput, fontSize: 12 },
                          value: editForm.category_id,
                          onChange: e => setEdit('category_id', e.target.value),
                        },
                          React.createElement('option', { value: '' }, 'ללא קטגוריה'),
                          filteredCats.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.icon || ''} ${c.name}`))
                        )
                      ),
                      React.createElement('td', { style: styles.td },
                        React.createElement('select', {
                          style: { ...inlineInput, fontSize: 12 },
                          value: editForm.account_id,
                          onChange: e => setEdit('account_id', e.target.value),
                        },
                          accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
                        )
                      ),
                      React.createElement('td', { style: { ...styles.td, textAlign: 'left' } },
                        React.createElement('input', {
                          style: { ...inlineInput, width: 80, textAlign: 'left' },
                          type: 'number', value: editForm.amount,
                          onChange: e => setEdit('amount', e.target.value),
                          onKeyDown: e => e.key === 'Enter' && saveEdit(tx.id),
                        })
                      ),
                      React.createElement('td', { style: styles.td },
                        React.createElement('div', { style: { display: 'flex', gap: 4 } },
                          React.createElement('button', {
                            style: { ...styles.deleteBtn, color: '#10B981', opacity: 1, fontSize: 12 },
                            onClick: () => saveEdit(tx.id),
                          }, '✓'),
                          React.createElement('button', {
                            style: { ...styles.deleteBtn, opacity: 1, fontSize: 12 },
                            onClick: () => setEditingTx(null),
                          }, '✕'),
                        )
                      ),
                    )
                  )
                }

                return React.createElement(React.Fragment, { key: tx.id },
                  // שורה רגילה
                  React.createElement('tr', {
                    style: {
                      ...styles.tr,
                      backgroundColor: tx.is_virtual ? '#F0F9FF' : isExpanded ? '#F8FAFC' : '#fff',
                      opacity: tx.is_virtual ? 0.85 : 1,
                      cursor: tx.is_virtual ? 'default' : 'pointer',
                    },
                    onClick: () => !tx.is_virtual && setExpandedTx(isExpanded ? null : tx.id),
                    onDoubleClick: () => !tx.is_virtual && startEdit(tx),
                  },
                    React.createElement('td', { style: styles.td }, tx.transaction_date),
                    React.createElement('td', { style: { ...styles.td, fontWeight: '500' } }, tx.business_entity || '—'),
                    React.createElement('td', { style: styles.td },
                      tx.category_name
                        ? React.createElement('span', { style: styles.badge }, tx.category_name)
                        : React.createElement('span', { style: styles.badgeEmpty }, 'ללא קטגוריה')
                    ),
                    React.createElement('td', { style: styles.td }, tx.account_name),
                    React.createElement('td', { style: { ...styles.td, textAlign: 'left' } },
                      React.createElement('span', {
                        style: { fontWeight: 'bold', color: tx.transaction_type === 'Income' ? '#10B981' : '#E11D48' }
                      }, `${tx.transaction_type === 'Income' ? '+' : '−'}${fmt(tx.amount)}`)
                    ),
                    React.createElement('td', { style: styles.td },
                      tx.is_virtual
                        ? React.createElement('button', {
                            style: { ...styles.deleteBtn, color: '#10B981', opacity: 1, fontSize: 13, fontWeight: '500' },
                            onClick: e => { e.stopPropagation(); handleConfirmVirtual(tx) },
                          }, '✓ אשר')
                        : React.createElement('button', {
                            style: styles.deleteBtn,
                            onClick: e => { e.stopPropagation(); handleDelete(tx.id) },
                          }, '🗑')
                    ),
                    React.createElement('td', { style: { ...styles.td, whiteSpace: 'nowrap' } },
                      !tx.is_virtual && React.createElement('div', { style: { display: 'flex', gap: 2 } },
                        React.createElement('button', {
                          style: { ...styles.deleteBtn, opacity: 1, fontSize: 13 },
                          title: 'שכפל',
                          onClick: e => { e.stopPropagation(); setDuplicateTx(tx) },
                        }, '📋'),
                        React.createElement('button', {
                          style: { ...styles.deleteBtn, opacity: 1, fontSize: 13 },
                          title: 'פצל',
                          onClick: e => { e.stopPropagation(); setSplitTx(tx) },
                        }, '✂️'),
                        React.createElement('button', {
                          style: { ...styles.deleteBtn, opacity: 1, fontSize: 13 },
                          title: 'קזז',
                          onClick: e => { e.stopPropagation(); setOffsetTx(tx) },
                        }, '⚖️'),
                      )
                    ),
                  ),

                  // אקורדיון
                  isExpanded && expandedData && React.createElement('tr', { key: `${tx.id}_exp`, style: { backgroundColor: '#F8FAFC' } },
                    React.createElement('td', { colSpan: 6, style: { padding: '12px 16px', borderBottom: '1px solid #E2E8F0' } },

                      isEditingFull
                        // ─── מצב עריכה מלאה ───
                        ? React.createElement('div', null,
                            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 } },
                              EditField('תאריך עסקה', React.createElement('input', { style: editInput, type: 'date', value: editForm.transaction_date, onChange: e => setEdit('transaction_date', e.target.value) })),
                              EditField('תאריך ערך', React.createElement('input', { style: editInput, type: 'date', value: editForm.value_date, onChange: e => setEdit('value_date', e.target.value) })),
                              EditField('סכום', React.createElement('input', { style: editInput, type: 'number', value: editForm.amount, onChange: e => setEdit('amount', e.target.value) })),
                              EditField('בית עסק', React.createElement('input', { style: editInput, value: editForm.business_entity, onChange: e => setEdit('business_entity', e.target.value) })),
                              EditField('קטגוריה', React.createElement('select', { style: editInput, value: editForm.category_id, onChange: e => setEdit('category_id', e.target.value) },
                                React.createElement('option', { value: '' }, 'ללא קטגוריה'),
                                categories.filter(c => tx.transaction_type === 'Income' ? c.type === 'Income' : c.type === 'Expense')
                                  .map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.icon || ''} ${c.name}`))
                              )),
                              EditField('חשבון', React.createElement('select', { style: editInput, value: editForm.account_id, onChange: e => setEdit('account_id', e.target.value) },
                                accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
                              )),
                              EditField('הערות', React.createElement('input', { style: editInput, value: editForm.description, onChange: e => setEdit('description', e.target.value) })),
                              EditField('תגיות', React.createElement('input', { style: editInput, value: editForm.tags, onChange: e => setEdit('tags', e.target.value), placeholder: 'תגית1, תגית2' })),
                            ),

                            // קישורים
                            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 } },
                              EditField('הלוואה מקושרת', React.createElement('select', { style: editInput, value: editForm.liability_id, onChange: e => setEdit('liability_id', e.target.value) },
                                React.createElement('option', { value: '' }, '— ללא —'),
                                db.prepare('SELECT id, name FROM Liabilities WHERE is_active=1').all()
                                  .map(l => React.createElement('option', { key: l.id, value: l.id }, l.name))
                              )),
                              EditField('הו"ק מקושר', React.createElement('select', { style: editInput, value: editForm.recurring_id, onChange: e => setEdit('recurring_id', e.target.value) },
                                React.createElement('option', { value: '' }, '— ללא —'),
                                db.prepare('SELECT id, name FROM Recurring_Templates WHERE is_active=1').all()
                                  .map(r => React.createElement('option', { key: r.id, value: r.id }, r.name))
                              )),
                              EditField('יעד חיסכון', React.createElement('select', { style: editInput, value: editForm.savings_goal_id, onChange: e => setEdit('savings_goal_id', e.target.value) },
                                React.createElement('option', { value: '' }, '— ללא —'),
                                db.prepare('SELECT id, name FROM Savings_Goals WHERE is_active=1').all()
                                  .map(g => React.createElement('option', { key: g.id, value: g.id }, g.name))
                              )),
                              EditField('ביטוח מקושר', React.createElement('select', { style: editInput, value: editForm.insurance_id, onChange: e => setEdit('insurance_id', e.target.value) },
                                React.createElement('option', { value: '' }, '— ללא —'),
                                db.prepare('SELECT id, name FROM Insurance_Policies WHERE is_active=1').all()
                                  .map(i => React.createElement('option', { key: i.id, value: i.id }, i.name))
                              )),
                            ),

                            // checkboxes
                            React.createElement('div', { style: { display: 'flex', gap: 16, marginBottom: 12 } },
                              React.createElement('label', { style: { fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 } },
                                React.createElement('input', { type: 'checkbox', checked: editForm.is_budgetary, onChange: e => setEdit('is_budgetary', e.target.checked) }),
                                ' תקציבי'
                              ),
                              React.createElement('label', { style: { fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 } },
                                React.createElement('input', { type: 'checkbox', checked: editForm.is_maaser_obligated, onChange: e => setEdit('is_maaser_obligated', e.target.checked) }),
                                ' חייב במעשר'
                              ),
                            ),

                            // כפתורים
                            React.createElement('div', { style: { display: 'flex', gap: 8 } },
                              React.createElement('button', {
                                style: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
                                onClick: () => saveFullEdit(tx.id),
                              }, 'שמור'),
                              React.createElement('button', {
                                style: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer' },
                                onClick: () => setEditingFull(null),
                              }, 'ביטול'),
                            ),
                          )

                        // ─── מצב צפייה ───
                        : React.createElement('div', null,
                            React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 8 } },
                              tx.value_date && InfoField('תאריך ערך', tx.value_date),
                              tx.created_at && InfoField('תאריך יצירה', tx.created_at.slice(0, 10)),
                              tx.description && InfoField('הערות', tx.description),
                              tx.tags && InfoField('תגיות', tx.tags),
                              expandedData.loan && InfoField('הלוואה מקושרת', expandedData.loan.name, '#E11D48'),
                              expandedData.recurring && InfoField(
                                expandedData.recurring.type === 'installment' ? 'עסקת תשלומים' : 'הוראת קבע',
                                expandedData.recurring.name, '#2563EB'
                              ),
                              expandedData.savingsGoal && InfoField('יעד חיסכון', expandedData.savingsGoal.name, '#10B981'),
                              expandedData.insurance && InfoField('ביטוח מקושר', expandedData.insurance.name, '#8B5CF6'),
                              expandedData.parent && InfoField('חלק מפיצול של', `${expandedData.parent.business_entity} (${fmt(expandedData.parent.amount)})`, '#F59E0B'),
                              expandedData.children.length > 0 && InfoField('פוצל ל', `${expandedData.children.length} חלקים`, '#F59E0B'),
                              expandedData.offsetGroup.length > 0 && InfoField('מקוזז עם', expandedData.offsetGroup.map(o => o.business_entity || fmt(o.amount)).join(', '), '#64748B'),
                            ),
                            React.createElement('button', {
                              style: { fontSize: 11, color: '#2563EB', background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
                              onClick: e => { e.stopPropagation(); startFullEdit(tx) },
                            }, '✏️ ערוך הכל'),
                          )
                    )
                  ),
                )
              })
            )
          )
    ),

    showModal && React.createElement(AddTransactionModal, {
      categories,
      accounts,
      selectedMonth,
      onClose: () => setShowModal(false),
      onSave: () => { setShowModal(false); loadData() },
    }),

    duplicateTx && React.createElement(DuplicateModal, {
      tx: duplicateTx,
      categories,
      accounts,
      onClose: () => setDuplicateTx(null),
      onSave: () => { setDuplicateTx(null); loadData() },
    }),

    splitTx && React.createElement(SplitModal, {
      tx: splitTx,
      categories,
      onClose: () => setSplitTx(null),
      onSave: () => { setSplitTx(null); loadData() },
    }),

    offsetTx && React.createElement(OffsetModal, {
      tx: offsetTx,
      categories,
      onClose: () => setOffsetTx(null),
      onSave: () => { setOffsetTx(null); loadData() },
    }),
  )
}

function SummaryCard(label, value, color) {
  return React.createElement('div', { key: label, style: styles.summaryCard },
    React.createElement('p', { style: styles.summaryLabel }, label),
    React.createElement('p', { style: { ...styles.summaryValue, color } }, value),
  )
}

function AddTransactionModal({ categories, accounts, onClose, onSave, selectedMonth }) {
  const today = new Date().toISOString().slice(0, 10)
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
  const isCurrentMonth = selectedMonth === currentMonth

  function getDefaultDate() {
    if (isCurrentMonth) return today
    try {
      const defaultDay = db.prepare(
        "SELECT cleaned_name FROM Automation_Rules WHERE original_string='default_transaction_day' AND match_type='setting'"
      ).get()
      const day = defaultDay ? parseInt(defaultDay.cleaned_name) : 25
      return `${selectedMonth}-${String(day).padStart(2, '0')}`
    } catch { return `${selectedMonth}-25` }
  }

  const [form, setForm] = useState({
    transaction_date: getDefaultDate(), value_date: getDefaultDate(),
    amount: '', transaction_type: 'Expense',
    business_entity: '', category_id: '', account_id: accounts[0]?.id ?? '',
    is_budgetary: true, is_maaser_obligated: true, description: '',
  })

  function handleSave(addAnother = false) {
    if (!form.amount || !form.account_id) return
    db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
        category_id, account_id, is_budgetary, is_maaser_obligated, description, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
    `).run(
      form.transaction_date, form.value_date || form.transaction_date,
      parseFloat(form.amount), form.transaction_type,
      form.business_entity, form.category_id || null, form.account_id,
      form.is_budgetary ? 1 : 0, form.is_maaser_obligated ? 1 : 0, form.description,
    )
    if (addAnother) {
      // נקה שדות אבל השאר את המודאל פתוח
      setForm(f => ({
        ...f,
        amount: '',
        business_entity: '',
        description: '',
        category_id: '',
      }))
    } else {
      onSave()
    }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const filteredCats = categories.filter(c => {
    if (form.transaction_type === 'Income')    return c.type === 'Income'
    if (form.transaction_type === 'Expense')   return c.type === 'Expense'
    if (form.transaction_type === 'Savings')   return c.type === 'Savings'
    return false
  })

  const showCategory = form.transaction_type !== 'Transfer'

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxHeight: '90vh', overflowY: 'auto' } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, 'תנועה חדשה'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        // סוג תנועה
        React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 16 } },
          ['Expense', 'Income', 'Transfer', 'Savings'].map(type =>
            React.createElement('button', {
              key: type,
              style: {
                ...styles.typeBtn,
                ...(form.transaction_type === type ? styles.typeBtnActive : {}),
              },
              onClick: () => set('transaction_type', type),
            }, { Expense: 'הוצאה', Income: 'הכנסה', Transfer: 'העברה', Savings: 'חיסכון' }[type])
          )
        ),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 } },
          Field('תאריך עסקה', React.createElement('input', { style: styles.input, type: 'date', value: form.transaction_date, onChange: e => set('transaction_date', e.target.value) })),
          Field('תאריך ערך', React.createElement('input', { style: styles.input, type: 'date', value: form.value_date, onChange: e => set('value_date', e.target.value) })),
          Field('סכום (₪)', React.createElement('input', { style: styles.input, type: 'number', placeholder: '0', value: form.amount, onChange: e => set('amount', e.target.value) })),
        ),
        Field('בית עסק', React.createElement('input', { style: styles.input, placeholder: 'שם העסק', value: form.business_entity, onChange: e => set('business_entity', e.target.value) })),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 } },
          showCategory && Field('קטגוריה', React.createElement('select', { style: styles.input, value: form.category_id, onChange: e => set('category_id', e.target.value) },
            React.createElement('option', { value: '' }, 'בחר קטגוריה'),
            filteredCats.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.icon} ${c.name}`))
          )),
          Field('חשבון', React.createElement('select', { style: styles.input, value: form.account_id, onChange: e => set('account_id', e.target.value) },
            accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
          )),
        ),
        React.createElement('div', { style: { display: 'flex', gap: 16 } },
          React.createElement('label', { style: styles.checkLabel },
            React.createElement('input', { type: 'checkbox', checked: form.is_budgetary, onChange: e => set('is_budgetary', e.target.checked) }),
            ' תקציבי'
          ),
          React.createElement('label', { style: styles.checkLabel },
            React.createElement('input', { type: 'checkbox', checked: form.is_maaser_obligated, onChange: e => set('is_maaser_obligated', e.target.checked) }),
            ' חייב במעשר'
          ),
        ),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', {
          style: { ...styles.btnSecondary, color: '#2563EB' },
          onClick: () => handleSave(true),
        }, '+ שמור והוסף'),
        React.createElement('button', { style: styles.btnPrimary, onClick: () => handleSave(false) }, 'שמור'),
      )
    )
  )
}

function Field(label, input) {
  return React.createElement('div', { style: { marginBottom: 12 } },
    React.createElement('label', { style: { fontSize: 12, fontWeight: '500', color: '#475569', display: 'block', marginBottom: 4 } }, label),
    input,
  )
}

const styles = {
  page: { padding: 32 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  headerActions: { display: 'flex', gap: 10, alignItems: 'center' },
  select: { border: '1px solid #E2E8F0', borderRadius: 10, padding: '6px 12px', fontSize: 13 },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
  btnSecondary: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  summaryRow: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 20 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  summaryLabel: { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 4 },
  summaryValue: { fontSize: 20, fontWeight: 'bold' },
  tableWrap: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { textAlign: 'right', fontSize: 11, fontWeight: '600', color: '#64748B', padding: '12px 16px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' },
  tr: { borderBottom: '1px solid #F1F5F9' },
  td: { padding: '12px 16px', fontSize: 13, color: '#0F172A' },
  badge: { backgroundColor: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: 6, fontSize: 11 },
  badgeEmpty: { color: '#CBD5E1', fontSize: 11 },
  deleteBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 16, opacity: 0.4 },
  empty: { textAlign: 'center', padding: '48px', color: '#94A3B8', fontSize: 14 },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', maxWidth: 460, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  typeBtn: { flex: 1, padding: '7px', borderRadius: 8, border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', fontSize: 12, cursor: 'pointer', color: '#475569' },
  typeBtnActive: { backgroundColor: '#2563EB', color: '#fff', border: '1px solid #2563EB' },
  checkLabel: { fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
}

function EditField(label, input) {
  return React.createElement('div', null,
    React.createElement('label', { style: { fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', display: 'block', marginBottom: 3 } }, label),
    input,
  )
}

function InfoField(label, value, color) {
  if (!value) return null
  return React.createElement('div', { style: { minWidth: 0 } },
    React.createElement('p', { style: { fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 2 } }, label),
    React.createElement('p', { style: { fontSize: 12, fontWeight: '500', color: color || '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, value),
  )
}

const inlineInput = {
  width: '100%', border: '1px solid #CBD5E1', borderRadius: 6,
  padding: '3px 6px', fontSize: 12, outline: 'none', boxSizing: 'border-box',
}

const editInput = {
  width: '100%', border: '1px solid #E2E8F0', borderRadius: 8,
  padding: '6px 10px', fontSize: 12, outline: 'none', boxSizing: 'border-box',
}

// ─── מודאל שכפול ─────────────────────────────────────────────────────────

function DuplicateModal({ tx, categories, accounts, onClose, onSave }) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    transaction_date: today,
    amount: tx.amount.toString(),
    transaction_type: tx.transaction_type,
    business_entity: tx.business_entity || '',
    category_id: tx.category_id?.toString() ?? '',
    account_id: tx.account_id?.toString() ?? '',
    is_budgetary: tx.is_budgetary ? true : false,
    is_maaser_obligated: tx.is_maaser_obligated ? true : false,
    description: tx.description || '',
    tags: tx.tags || '',
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleSave() {
    db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
         category_id, account_id, is_budgetary, is_maaser_obligated,
         description, tags, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')
    `).run(
      form.transaction_date, form.transaction_date,
      parseFloat(form.amount), form.transaction_type, form.business_entity,
      form.category_id || null, form.account_id,
      form.is_budgetary ? 1 : 0, form.is_maaser_obligated ? 1 : 0,
      form.description || null, form.tags || null
    )
    onSave()
  }

  const filteredCats = categories.filter(c =>
    form.transaction_type === 'Income' ? c.type === 'Income' : c.type === 'Expense'
  )

  return React.createElement('div', { style: mStyles.overlay },
    React.createElement('div', { style: { ...mStyles.modal, maxWidth: 460 } },
      React.createElement('div', { style: mStyles.header },
        React.createElement('h2', { style: mStyles.title }, '📋 שכפול תנועה'),
        React.createElement('button', { style: mStyles.close, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: mStyles.body },
        React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 16, backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8 } },
          `משכפל מ: ${tx.business_entity} — ₪${tx.amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`
        ),
        MField('תאריך', React.createElement('input', { style: mStyles.input, type: 'date', value: form.transaction_date, onChange: e => set('transaction_date', e.target.value) })),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          MField('סכום (₪)', React.createElement('input', { style: mStyles.input, type: 'number', value: form.amount, onChange: e => set('amount', e.target.value) })),
          MField('בית עסק', React.createElement('input', { style: mStyles.input, value: form.business_entity, onChange: e => set('business_entity', e.target.value) })),
        ),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          MField('קטגוריה', React.createElement('select', { style: mStyles.input, value: form.category_id, onChange: e => set('category_id', e.target.value) },
            React.createElement('option', { value: '' }, 'ללא קטגוריה'),
            filteredCats.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.icon || ''} ${c.name}`))
          )),
          MField('חשבון', React.createElement('select', { style: mStyles.input, value: form.account_id, onChange: e => set('account_id', e.target.value) },
            accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
          )),
        ),
      ),
      React.createElement('div', { style: mStyles.footer },
        React.createElement('button', { style: mStyles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: mStyles.btnPrimary, onClick: handleSave }, 'שכפל'),
      ),
    )
  )
}

// ─── מודאל פיצול ─────────────────────────────────────────────────────────

function SplitModal({ tx, categories, onClose, onSave }) {
  const [rows, setRows] = useState([
    { amount: '', category_id: '', description: '' },
    { amount: '', category_id: '', description: '' },
  ])

  const total = tx.amount
  const usedAmount = rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0)
  const remainder = Math.round((total - usedAmount) * 100) / 100
  const isValid = Math.abs(remainder) < 0.01

  function updateRow(i, k, v) {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [k]: v } : r))
  }

  function addRow() {
    setRows(prev => [...prev, { amount: '', category_id: '', description: '' }])
  }

  function removeRow(i) {
    if (rows.length <= 2) return
    setRows(prev => prev.filter((_, idx) => idx !== i))
  }

  function handleSave() {
    if (!isValid) return

    // עדכן תנועת אב
    db.prepare('UPDATE Transactions SET is_budgetary=0, is_maaser_obligated=0 WHERE id=?').run(tx.id)

    // צור תנועות ילד
    const stmt = db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
         category_id, account_id, parent_id, is_budgetary, is_maaser_obligated,
         description, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'manual')
    `)

    const ids = []
    const insertAll = db.transaction(() => {
      for (const row of rows) {
        const result = stmt.run(
          tx.transaction_date, tx.value_date || tx.transaction_date,
          parseFloat(row.amount), tx.transaction_type, tx.business_entity,
          row.category_id || null, tx.account_id, tx.id,
          tx.is_maaser_obligated ? 1 : 0,
          row.description || null
        )
        ids.push(result.lastInsertRowid)
      }
    })
    insertAll()

    // עדכן description של האב
    db.prepare('UPDATE Transactions SET description=? WHERE id=?')
      .run(`פוצל לתנועות: ${ids.join(', ')}`, tx.id)

    onSave()
  }

  const expenseCats = categories.filter(c => tx.transaction_type === 'Income' ? c.type === 'Income' : c.type === 'Expense')

  return React.createElement('div', { style: mStyles.overlay },
    React.createElement('div', { style: { ...mStyles.modal, maxWidth: 520 } },
      React.createElement('div', { style: mStyles.header },
        React.createElement('h2', { style: mStyles.title }, '✂️ פיצול תנועה'),
        React.createElement('button', { style: mStyles.close, onClick: onClose }, '✕'),
      ),

      // מידע על התנועה המקורית
      React.createElement('div', { style: { padding: '10px 24px', backgroundColor: '#FEF2F2', borderBottom: '1px solid #E2E8F0' } },
        React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A' } },
          `${tx.business_entity} — ₪${total.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`
        ),
      ),

      React.createElement('div', { style: mStyles.body },
        // שורות פיצול
        rows.map((row, i) =>
          React.createElement('div', { key: i, style: { display: 'grid', gridTemplateColumns: '100px 1fr 1fr auto', gap: 8, marginBottom: 10, alignItems: 'end' } },
            MField('סכום', React.createElement('input', {
              style: mStyles.input, type: 'number',
              value: row.amount,
              placeholder: i === rows.length - 1 && remainder >= 0 ? remainder.toString() : '',
              onChange: e => updateRow(i, 'amount', e.target.value),
            })),
            MField('קטגוריה', React.createElement('select', { style: mStyles.input, value: row.category_id, onChange: e => updateRow(i, 'category_id', e.target.value) },
              React.createElement('option', { value: '' }, 'בחר...'),
              expenseCats.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.icon || ''} ${c.name}`))
            )),
            MField('הערה', React.createElement('input', { style: mStyles.input, value: row.description, onChange: e => updateRow(i, 'description', e.target.value), placeholder: 'אופציונלי' })),
            React.createElement('button', {
              style: { ...mStyles.btnSecondary, padding: '6px 10px', fontSize: 12, opacity: rows.length <= 2 ? 0.3 : 1 },
              onClick: () => removeRow(i),
              disabled: rows.length <= 2,
            }, '✕'),
          )
        ),

        React.createElement('button', {
          style: { ...mStyles.btnSecondary, fontSize: 12, marginBottom: 12 },
          onClick: addRow,
        }, '+ הוסף שורה'),

        // סיכום
        React.createElement('div', { style: { backgroundColor: isValid ? '#F0FDF4' : '#FEF2F2', borderRadius: 10, padding: 12 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13 } },
            React.createElement('span', { style: { color: '#475569' } }, 'סה"כ שורות:'),
            React.createElement('span', { style: { fontWeight: '600' } }, `₪${usedAmount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`),
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginTop: 4 } },
            React.createElement('span', { style: { color: '#475569' } }, 'שארית:'),
            React.createElement('span', { style: { fontWeight: '600', color: isValid ? '#10B981' : '#E11D48' } },
              `₪${remainder.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`
            ),
          ),
          !isValid && React.createElement('p', { style: { fontSize: 11, color: '#E11D48', marginTop: 4 } },
            'סכום השורות חייב להיות שווה לסכום המקורי'
          ),
        ),
      ),

      React.createElement('div', { style: mStyles.footer },
        React.createElement('button', { style: mStyles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', {
          style: { ...mStyles.btnPrimary, opacity: !isValid ? 0.5 : 1 },
          disabled: !isValid,
          onClick: handleSave,
        }, 'פצל'),
      ),
    )
  )
}

// ─── מודאל קיזוז ─────────────────────────────────────────────────────────

function OffsetModal({ tx, categories, onClose, onSave }) {
  const [search, setSearch] = useState('')
  const [basket, setBasket] = useState([])
  const [remainderCategoryId, setRemainderCategoryId] = useState('')

  const signedAmount = tx.transaction_type === 'Income' ? tx.amount : -tx.amount

  const searchResults = search.length > 1
    ? db.prepare(`
        SELECT t.*, c.name as category_name FROM Transactions t
        LEFT JOIN Categories c ON t.category_id=c.id
        WHERE t.id != ?
          AND (t.business_entity LIKE ? OR CAST(t.amount AS TEXT) LIKE ?)
          AND t.offset_group_id IS NULL
        LIMIT 10
      `).all(tx.id, `%${search}%`, `%${search}%`)
    : []

  function addToBasket(t) {
    if (basket.find(b => b.id === t.id)) return
    setBasket(prev => [...prev, t])
    setSearch('')
  }

  function removeFromBasket(id) {
    setBasket(prev => prev.filter(b => b.id !== id))
  }

  const basketTotal = basket.reduce((s, t) =>
    s + (t.transaction_type === 'Income' ? t.amount : -t.amount), 0
  )
  const remainder = Math.round((signedAmount + basketTotal) * 100) / 100
  const hasRemainder = Math.abs(remainder) > 0.01

  function handleSave() {
    // צור group_id
    const groupId = Date.now()

    // עדכן תנועת עוגן
    db.prepare('UPDATE Transactions SET offset_group_id=?, is_budgetary=0, is_maaser_obligated=0 WHERE id=?')
      .run(groupId, tx.id)

    // עדכן כל תנועות העגלה
    const updateStmt = db.prepare('UPDATE Transactions SET offset_group_id=?, is_budgetary=0, is_maaser_obligated=0 WHERE id=?')
    const updateAll = db.transaction(() => {
      for (const t of basket) updateStmt.run(groupId, t.id)
    })
    updateAll()

    // צור תנועת שארית אם קיימת
    if (hasRemainder && remainderCategoryId) {
      const remType = remainder > 0 ? 'Income' : 'Expense'
      db.prepare(`
        INSERT INTO Transactions
          (transaction_date, value_date, amount, transaction_type, business_entity,
           category_id, account_id, offset_group_id, is_budgetary, is_maaser_obligated,
           description, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, 'manual')
      `).run(
        tx.transaction_date, tx.transaction_date,
        Math.abs(remainder), remType,
        'שארית קיזוז',
        remainderCategoryId, tx.account_id, groupId,
        `שארית מקיזוז תנועה מס' ${tx.id}`
      )
    }

    onSave()
  }

  const fmt = n => '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL')

  return React.createElement('div', { style: mStyles.overlay },
    React.createElement('div', { style: { ...mStyles.modal, maxWidth: 560 } },
      React.createElement('div', { style: mStyles.header },
        React.createElement('h2', { style: mStyles.title }, '⚖️ קיזוז תנועות'),
        React.createElement('button', { style: mStyles.close, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: mStyles.body },

        // תנועת עוגן
        React.createElement('div', { style: {
          padding: 12, borderRadius: 10, marginBottom: 16,
          backgroundColor: tx.transaction_type === 'Income' ? '#F0FDF4' : '#FEF2F2',
          border: `1px solid ${tx.transaction_type === 'Income' ? '#BBF7D0' : '#FCA5A5'}`,
        }},
          React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 2 } }, 'תנועת עוגן'),
          React.createElement('p', { style: { fontSize: 14, fontWeight: '600', color: '#0F172A' } },
            `${tx.business_entity} — ${tx.transaction_type === 'Income' ? '+' : '−'}${fmt(tx.amount)}`
          ),
        ),

        // חיפוש
        React.createElement('div', { style: { marginBottom: 12 } },
          React.createElement('input', {
            style: { ...mStyles.input, marginBottom: 6 },
            placeholder: 'חפש תנועה לקיזוז (שם, סכום)...',
            value: search,
            onChange: e => setSearch(e.target.value),
          }),
          searchResults.length > 0 && React.createElement('div', { style: { border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' } },
            searchResults.map(t =>
              React.createElement('div', {
                key: t.id,
                style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #F1F5F9' },
                onClick: () => addToBasket(t),
              },
                React.createElement('div', null,
                  React.createElement('p', { style: { fontSize: 13, fontWeight: '500' } }, t.business_entity || '—'),
                  React.createElement('p', { style: { fontSize: 11, color: '#64748B' } }, t.transaction_date),
                ),
                React.createElement('span', { style: { fontSize: 13, fontWeight: '600', color: t.transaction_type === 'Income' ? '#10B981' : '#E11D48' } },
                  `${t.transaction_type === 'Income' ? '+' : '−'}${fmt(t.amount)}`
                ),
              )
            )
          ),
        ),

        // עגלת קיזוזים
        basket.length > 0 && React.createElement('div', { style: { marginBottom: 12 } },
          React.createElement('p', { style: { fontSize: 11, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', marginBottom: 6 } }, 'עגלת קיזוזים'),
          basket.map(t =>
            React.createElement('div', { key: t.id, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', backgroundColor: '#F8FAFC', borderRadius: 8, marginBottom: 4 } },
              React.createElement('p', { style: { fontSize: 13 } }, t.business_entity || '—'),
              React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                React.createElement('span', { style: { fontSize: 13, fontWeight: '500', color: t.transaction_type === 'Income' ? '#10B981' : '#E11D48' } },
                  `${t.transaction_type === 'Income' ? '+' : '−'}${fmt(t.amount)}`
                ),
                React.createElement('button', { style: { background: 'none', border: 'none', cursor: 'pointer', color: '#94A3B8', fontSize: 14 }, onClick: () => removeFromBasket(t.id) }, '✕'),
              ),
            )
          ),
        ),

        // סיכום ושארית
        React.createElement('div', { style: { backgroundColor: hasRemainder ? '#FFFBEB' : '#F0FDF4', borderRadius: 10, padding: 12, marginBottom: hasRemainder ? 12 : 0 } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 } },
            React.createElement('span', { style: { color: '#475569' } }, 'תנועת עוגן:'),
            React.createElement('span', { style: { fontWeight: '600' } }, `${signedAmount >= 0 ? '+' : '−'}${fmt(Math.abs(signedAmount))}`),
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 4 } },
            React.createElement('span', { style: { color: '#475569' } }, 'עגלת קיזוזים:'),
            React.createElement('span', { style: { fontWeight: '600' } }, `${basketTotal >= 0 ? '+' : '−'}${fmt(Math.abs(basketTotal))}`),
          ),
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 13, paddingTop: 8, borderTop: '1px solid #E2E8F0' } },
            React.createElement('span', { style: { fontWeight: '600' } }, 'שארית:'),
            React.createElement('span', { style: { fontWeight: '700', color: hasRemainder ? '#F59E0B' : '#10B981' } },
              hasRemainder ? `${remainder >= 0 ? '+' : '−'}${fmt(Math.abs(remainder))}` : '✓ מאוזן'
            ),
          ),
        ),

        // בחירת קטגוריה לשארית
        hasRemainder && React.createElement('div', null,
          React.createElement('p', { style: { fontSize: 12, color: '#F59E0B', marginBottom: 6 } },
            `נוצרה שארית ${remainder > 0 ? 'הכנסה' : 'הוצאה'} בסך ${fmt(Math.abs(remainder))} — בחר קטגוריה:`
          ),
          React.createElement('select', {
            style: mStyles.input,
            value: remainderCategoryId,
            onChange: e => setRemainderCategoryId(e.target.value),
          },
            React.createElement('option', { value: '' }, 'בחר קטגוריה לשארית...'),
            categories
              .filter(c => remainder > 0 ? c.type === 'Income' : c.type === 'Expense')
              .map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.icon || ''} ${c.name}`))
          ),
        ),
      ),

      React.createElement('div', { style: mStyles.footer },
        React.createElement('button', { style: mStyles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', {
          style: { ...mStyles.btnPrimary, opacity: (basket.length === 0 || (hasRemainder && !remainderCategoryId)) ? 0.5 : 1 },
          disabled: basket.length === 0 || (hasRemainder && !remainderCategoryId),
          onClick: handleSave,
        }, 'קזז'),
      ),
    )
  )
}

function MField(label, input) {
  return React.createElement('div', null,
    React.createElement('label', { style: { fontSize: 11, color: '#64748B', display: 'block', marginBottom: 3 } }, label),
    input,
  )
}

const mStyles = {
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  title: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  close: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  body: { padding: 24 },
  footer: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
  btnSecondary: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
}

module.exports = Transactions