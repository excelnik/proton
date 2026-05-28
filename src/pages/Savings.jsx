const React = require('react')
const { useState, useEffect, useMemo } = React
const db = require('../db/index.js')

function calculateRequired(goal) {
  const today = new Date()
  const target = new Date(goal.target_date)
  const monthsLeft = Math.max(1,
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth())
  )

  const current = getCurrentBalance(goal.id, goal.starting_balance)
  const needed = goal.target_amount - current
  if (needed <= 0) return 0

  const r = goal.annual_interest_rate / 100 / 12
  if (r === 0) return needed / monthsLeft

  return (needed * r) / (1 - Math.pow(1 + r, -monthsLeft))
}

function getCurrentBalance(goalId, startingBalance) {
  const result = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type='Savings' THEN amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN transaction_type='Expense' AND savings_goal_id IS NOT NULL THEN amount ELSE 0 END), 0) as withdrawals
    FROM Transactions WHERE savings_goal_id=?
  `).get(goalId)
  return (startingBalance || 0) + (result?.deposits || 0) - (result?.withdrawals || 0)
}

function Savings() {
  const [goals, setGoals] = useState([])
  const [archivedGoals, setArchivedGoals] = useState([])
  const [showArchive, setShowArchive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editGoal, setEditGoal] = useState(null)
  const [depositGoal, setDepositGoal] = useState(null)
  const [linkGoal, setLinkGoal] = useState(null)

  function loadGoals() {
    const active = db.prepare('SELECT * FROM Savings_Goals WHERE is_active=1 ORDER BY target_date ASC').all()
    const archived = db.prepare('SELECT * FROM Savings_Goals WHERE is_active=0 ORDER BY id DESC').all()
    setGoals(active)
    setArchivedGoals(archived)
  }

  useEffect(() => { loadGoals() }, [])

  const summary = useMemo(() => {
    let totalSaved = 0, totalTarget = 0, totalRequired = 0
    for (const goal of goals) {
      totalSaved += getCurrentBalance(goal.id, goal.starting_balance)
      totalTarget += goal.target_amount
      totalRequired += calculateRequired(goal)
    }
    return { totalSaved, totalTarget, totalRequired }
  }, [goals])

  function handleArchive(goal) {
    db.prepare('UPDATE Savings_Goals SET is_active=0 WHERE id=?').run(goal.id)
    loadGoals()
  }

  const fmt = n => '₪' + Math.abs(n).toLocaleString('he-IL', { maximumFractionDigits: 0 })

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'יעדי חיסכון'),
      React.createElement('button', {
        style: styles.btnPrimary,
        onClick: () => { setEditGoal(null); setShowModal(true) },
      }, '+ יעד חדש'),
    ),

    // 3 כרטיסי סיכום
    React.createElement('div', { style: styles.grid3 },
      KpiCard('סך הכל נחסך', fmt(summary.totalSaved), '#10B981'),
      KpiCard('סך יעדים כולל', fmt(summary.totalTarget), '#2563EB'),
      KpiCard('הפקדה חודשית נדרשת', fmt(summary.totalRequired), '#F59E0B'),
    ),

    // Grid כרטיסים
    goals.length === 0
      ? React.createElement('div', { style: styles.empty },
          React.createElement('p', { style: { fontSize: 36 } }, '🎯'),
          React.createElement('p', { style: { fontWeight: '600', color: '#475569' } }, 'אין יעדי חיסכון פעילים'),
          React.createElement('button', {
            style: styles.btnPrimary,
            onClick: () => { setEditGoal(null); setShowModal(true) },
          }, 'הוסף יעד ראשון'),
        )
      : React.createElement('div', { style: styles.goalsGrid },
          goals.map(goal => React.createElement(GoalCard, {
            key: goal.id,
            goal,
            fmt,
            onEdit: () => { setEditGoal(goal); setShowModal(true) },
            onDeposit: () => setDepositGoal(goal),
            onLink: () => setLinkGoal(goal),
            onArchive: () => handleArchive(goal),
          }))
        ),

    // ארכיון
    archivedGoals.length > 0 && React.createElement('div', { style: { marginTop: 24 } },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' },
        onClick: () => setShowArchive(s => !s),
      },
        React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
        React.createElement('p', { style: { fontSize: 11, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' } },
          `${showArchive ? '▲' : '▼'} ארכיון (${archivedGoals.length})`
        ),
        React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
      ),
      showArchive && React.createElement('div', { style: styles.goalsGrid },
        archivedGoals.map(goal =>
          React.createElement('div', { key: goal.id, style: { ...styles.card, opacity: 0.6 } },
            React.createElement('p', { style: styles.goalName }, goal.name),
            React.createElement('p', { style: styles.goalSub }, `יעד: ${fmt(goal.target_amount)}`),
          )
        )
      ),
    ),

    // מודאלים
    showModal && React.createElement(GoalModal, {
      editGoal,
      onClose: () => { setShowModal(false); setEditGoal(null) },
      onSave: () => { setShowModal(false); setEditGoal(null); loadGoals() },
    }),

    depositGoal && React.createElement(DepositModal, {
      goal: depositGoal,
      fmt,
      onClose: () => setDepositGoal(null),
      onSave: () => { setDepositGoal(null); loadGoals() },
    }),

    linkGoal && React.createElement(LinkModal, {
      goal: linkGoal,
      fmt,
      onClose: () => setLinkGoal(null),
      onSave: () => { setLinkGoal(null); loadGoals() },
    }),
  )
}

// ─── כרטיס יעד ────────────────────────────────────────────────────────────

function GoalCard({ goal, fmt, onEdit, onDeposit, onLink, onArchive }) {
  const current = getCurrentBalance(goal.id, goal.starting_balance)
  const progress = Math.min(100, Math.round((current / goal.target_amount) * 100))
  const required = calculateRequired(goal)
  const isComplete = current >= goal.target_amount

  const today = new Date()
  const target = new Date(goal.target_date)
  const monthsLeft = Math.max(0,
    (target.getFullYear() - today.getFullYear()) * 12 +
    (target.getMonth() - today.getMonth())
  )

  return React.createElement('div', { style: { ...styles.card, position: 'relative', overflow: 'hidden' } },

    // כותרת
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } },
      React.createElement('p', { style: styles.goalName }, goal.name),
      isComplete && React.createElement('span', { style: { fontSize: 11, backgroundColor: '#D1FAE5', color: '#065F46', padding: '2px 8px', borderRadius: 6, fontWeight: '600' } }, '✓ הושלם!'),
    ),

    // פס התקדמות עבה
    React.createElement('div', { style: { marginBottom: 12 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginBottom: 6 } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: '600', color: '#10B981' } }, fmt(current)),
        React.createElement('span', { style: { fontSize: 13, color: '#94A3B8' } }, fmt(goal.target_amount)),
      ),
      React.createElement('div', { style: { height: 12, backgroundColor: '#E2E8F0', borderRadius: 6, overflow: 'hidden' } },
        React.createElement('div', {
          style: {
            height: '100%',
            borderRadius: 6,
            backgroundColor: isComplete ? '#10B981' : progress > 66 ? '#2563EB' : progress > 33 ? '#F59E0B' : '#E11D48',
            width: `${progress}%`,
            transition: 'width 0.4s',
          }
        })
      ),
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', marginTop: 4 } },
        React.createElement('span', { style: { fontSize: 11, color: '#64748B' } }, `${progress}% הושלם`),
        React.createElement('span', { style: { fontSize: 11, color: '#64748B' } }, `${monthsLeft} חודשים נותרו`),
      ),
    ),

    // נתונים
    React.createElement('div', { style: { backgroundColor: '#F8FAFC', borderRadius: 10, padding: 10, marginBottom: 12 } },
      React.createElement('p', { style: { fontSize: 12, color: '#475569' } },
        `תאריך יעד: ${goal.target_date.slice(0, 7)}`
      ),
      !isComplete && React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: '#2563EB', marginTop: 4 } },
        `הפקדה חודשית נדרשת: ${fmt(required)}`
      ),
    ),

    // כפתורי פעולה
    React.createElement('div', { style: { display: 'flex', gap: 8 } },
      React.createElement('button', {
        style: { ...styles.btnPrimary, flex: 1, fontSize: 12, padding: '7px 8px' },
        onClick: onDeposit,
      }, '💰 הפקד / משוך'),
      React.createElement('button', {
        style: { ...styles.btnSecondary, fontSize: 12, padding: '7px 10px' },
        onClick: onLink,
        title: 'שייך תנועה קיימת',
      }, '🔗'),
      React.createElement('button', {
        style: { ...styles.btnSecondary, fontSize: 12, padding: '7px 10px' },
        onClick: onEdit,
        title: 'ערוך',
      }, '✏️'),
      React.createElement('button', {
        style: { ...styles.btnSecondary, fontSize: 12, padding: '7px 10px' },
        onClick: onArchive,
        title: 'העבר לארכיון',
      }, '✓'),
    ),
  )
}

// ─── מודאל הוספה/עריכה ────────────────────────────────────────────────────

function GoalModal({ editGoal, onClose, onSave }) {
  const accounts = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
  const [form, setForm] = useState({
    name: editGoal?.name ?? '',
    target_amount: editGoal?.target_amount?.toString() ?? '',
    target_date: editGoal?.target_date ?? '',
    starting_balance: editGoal?.starting_balance?.toString() ?? '0',
    annual_interest_rate: editGoal?.annual_interest_rate?.toString() ?? '0',
    account_id: editGoal?.account_id?.toString() ?? '',
  })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleSave() {
    if (!form.name || !form.target_amount || !form.target_date) {
      setError('נא למלא שם, סכום יעד ותאריך')
      return
    }
    if (editGoal) {
      db.prepare(`
        UPDATE Savings_Goals SET name=?, target_amount=?, target_date=?,
        starting_balance=?, annual_interest_rate=?, account_id=? WHERE id=?
      `).run(
        form.name, parseFloat(form.target_amount), form.target_date,
        parseFloat(form.starting_balance) || 0,
        parseFloat(form.annual_interest_rate) || 0,
        form.account_id || null, editGoal.id
      )
    } else {
      db.prepare(`
        INSERT INTO Savings_Goals (name, target_amount, target_date, starting_balance, annual_interest_rate, account_id, is_active)
        VALUES (?, ?, ?, ?, ?, ?, 1)
      `).run(
        form.name, parseFloat(form.target_amount), form.target_date,
        parseFloat(form.starting_balance) || 0,
        parseFloat(form.annual_interest_rate) || 0,
        form.account_id || null
      )
    }
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 460 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, editGoal ? 'עריכת יעד' : 'יעד חיסכון חדש'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        Field('שם היעד', React.createElement('input', { style: styles.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'קרן חירום, חופשה ביפן...' })),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('סכום יעד (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.target_amount, onChange: e => set('target_amount', e.target.value), placeholder: '20000' })),
          Field('תאריך יעד', React.createElement('input', { style: styles.input, type: 'month', value: form.target_date?.slice(0, 7) ?? '', onChange: e => set('target_date', e.target.value + '-01') })),
        ),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('יתרת פתיחה (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.starting_balance, onChange: e => set('starting_balance', e.target.value), placeholder: '0' })),
          Field('ריבית שנתית (%)', React.createElement('input', { style: styles.input, type: 'number', step: '0.1', value: form.annual_interest_rate, onChange: e => set('annual_interest_rate', e.target.value), placeholder: '0' })),
        ),
        Field('חשבון מקושר', React.createElement('select', { style: styles.input, value: form.account_id, onChange: e => set('account_id', e.target.value) },
          React.createElement('option', { value: '' }, '— לא משויך —'),
          accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
        )),
        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnPrimary, onClick: handleSave }, editGoal ? 'שמור' : 'צור יעד'),
      ),
    )
  )
}

// ─── מודאל הפקדה/משיכה ────────────────────────────────────────────────────

function DepositModal({ goal, fmt, onClose, onSave }) {
  const accounts = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
  const required = calculateRequired(goal)
  const [tab, setTab] = useState('link')
  const [selected, setSelected] = useState(null)
  const [type, setType] = useState('deposit')
  const [amount, setAmount] = useState(Math.round(required).toString())
  const [accountId, setAccountId] = useState(goal.account_id?.toString() ?? accounts[0]?.id?.toString() ?? '')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [showAddTx, setShowAddTx] = useState(false)

  const linkableTxs = db.prepare(`
    SELECT t.*, a.name as account_name FROM Transactions t
    LEFT JOIN Accounts a ON t.account_id = a.id
    WHERE (t.transaction_type='Savings' OR t.transaction_type='Transfer')
      AND t.savings_goal_id IS NULL
      AND t.transaction_date >= date('now', '-365 days')
    ORDER BY t.transaction_date DESC
  `).all()

  function handleLink() {
    if (!selected) return
    db.prepare('UPDATE Transactions SET savings_goal_id=? WHERE id=?').run(goal.id, selected)
    onSave()
  }

  function handleSaveOnly() {
    // שמור רק את הנתון ביעד — ללא תנועה
    // זה מיועד למקרה שהמשתמש רוצה לעדכן יתרת פתיחה
    const current = getCurrentBalance(goal.id, goal.starting_balance)
    const newBalance = type === 'deposit'
      ? current + parseFloat(amount)
      : current - parseFloat(amount)
    db.prepare('UPDATE Savings_Goals SET starting_balance=? WHERE id=?').run(newBalance, goal.id)
    onSave()
  }

  function handleSaveWithTx() {
    setShowAddTx(true)
  }

  function confirmAddTx() {
    if (!amount || !accountId) return
    db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
         savings_goal_id, account_id, is_budgetary, is_maaser_obligated, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0, 'manual')
    `).run(
      date, date,
      parseFloat(amount),
      type === 'deposit' ? 'Savings' : 'Expense',
      type === 'deposit' ? `הפקדה — ${goal.name}` : `משיכה — ${goal.name}`,
      goal.id, accountId
    )
    onSave()
  }

  // אם נפתח מודאל תנועה
  if (showAddTx) {
    return React.createElement('div', { style: styles.overlay },
      React.createElement('div', { style: { ...styles.modal, maxWidth: 420 } },
        React.createElement('div', { style: styles.modalHeader },
          React.createElement('h2', { style: styles.modalTitle }, 'יצירת תנועה'),
          React.createElement('button', { style: styles.closeBtn, onClick: () => setShowAddTx(false) }, '✕'),
        ),
        React.createElement('div', { style: styles.modalBody },
          React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 16, backgroundColor: '#EFF6FF', padding: 10, borderRadius: 8 } },
            'הנתונים ממולאים מראש. תוכל לערוך לפני השמירה.'
          ),
          Field('תאריך', React.createElement('input', { style: styles.input, type: 'date', value: date, onChange: e => setDate(e.target.value) })),
          Field('סכום (₪)', React.createElement('input', { style: styles.input, type: 'number', value: amount, onChange: e => setAmount(e.target.value) })),
          Field('חשבון', React.createElement('select', { style: styles.input, value: accountId, onChange: e => setAccountId(e.target.value) },
            accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
          )),
        ),
        React.createElement('div', { style: styles.modalFooter },
          React.createElement('button', { style: styles.btnSecondary, onClick: () => setShowAddTx(false) }, 'חזור'),
          React.createElement('button', { style: styles.btnPrimary, onClick: confirmAddTx }, 'שמור תנועה'),
        ),
      )
    )
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 500 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, `💰 ${goal.name}`),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),

      // לשוניות
      React.createElement('div', { style: { display: 'flex', borderBottom: '1px solid #E2E8F0' } },
        React.createElement('button', {
          style: { flex: 1, padding: '12px', border: 'none', fontSize: 13, cursor: 'pointer', borderBottom: tab === 'link' ? '2px solid #2563EB' : 'none', backgroundColor: '#fff', color: tab === 'link' ? '#2563EB' : '#475569', fontWeight: tab === 'link' ? '600' : '400' },
          onClick: () => setTab('link'),
        }, '🔗 שייך תנועה קיימת'),
        React.createElement('button', {
          style: { flex: 1, padding: '12px', border: 'none', fontSize: 13, cursor: 'pointer', borderBottom: tab === 'manual' ? '2px solid #2563EB' : 'none', backgroundColor: '#fff', color: tab === 'manual' ? '#2563EB' : '#475569', fontWeight: tab === 'manual' ? '600' : '400' },
          onClick: () => setTab('manual'),
        }, '✏️ הזן ידנית'),
      ),

      // תוכן לשונית שיוך
      tab === 'link' && React.createElement('div', { style: { ...styles.modalBody, maxHeight: 350, overflowY: 'auto' } },
        linkableTxs.length === 0
          ? React.createElement('p', { style: { color: '#94A3B8', textAlign: 'center', padding: 20 } }, 'אין תנועות מתאימות בשנה האחרונה')
          : linkableTxs.map(tx =>
              React.createElement('div', {
                key: tx.id,
                style: {
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, marginBottom: 6, cursor: 'pointer',
                  backgroundColor: selected === tx.id ? '#EFF6FF' : '#F8FAFC',
                  border: selected === tx.id ? '1px solid #2563EB' : '1px solid #E2E8F0',
                },
                onClick: () => setSelected(tx.id),
              },
                React.createElement('input', { type: 'radio', checked: selected === tx.id, onChange: () => setSelected(tx.id) }),
                React.createElement('div', { style: { flex: 1 } },
                  React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A' } }, tx.business_entity || '—'),
                  React.createElement('p', { style: { fontSize: 11, color: '#64748B' } }, `${tx.transaction_date} | ${tx.account_name}`),
                ),
                React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: '#10B981' } }, fmt(tx.amount)),
              )
            )
      ),

      // תוכן לשונית ידנית
      tab === 'manual' && React.createElement('div', { style: styles.modalBody },
        React.createElement('div', { style: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 } },
          React.createElement('button', {
            style: { flex: 1, padding: '8px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: type === 'deposit' ? '#2563EB' : '#F8FAFC', color: type === 'deposit' ? '#fff' : '#475569' },
            onClick: () => setType('deposit'),
          }, '💰 הפקדה'),
          React.createElement('button', {
            style: { flex: 1, padding: '8px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: type === 'withdrawal' ? '#E11D48' : '#F8FAFC', color: type === 'withdrawal' ? '#fff' : '#475569' },
            onClick: () => setType('withdrawal'),
          }, '📤 משיכה'),
        ),
        Field('תאריך', React.createElement('input', { style: styles.input, type: 'date', value: date, onChange: e => setDate(e.target.value) })),
        Field('סכום (₪)', React.createElement('div', null,
          React.createElement('input', { style: styles.input, type: 'number', value: amount, onChange: e => setAmount(e.target.value) }),
          required > 0 && React.createElement('p', { style: { fontSize: 11, color: '#64748B', marginTop: 4 } },
            `הפקדה חודשית מומלצת: ${fmt(required)}`
          ),
        )),
        Field('חשבון', React.createElement('select', { style: styles.input, value: accountId, onChange: e => setAccountId(e.target.value) },
          accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
        )),
      ),

      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        tab === 'link'
          ? React.createElement('button', {
              style: { ...styles.btnPrimary, opacity: !selected ? 0.5 : 1 },
              disabled: !selected,
              onClick: handleLink,
            }, 'שייך תנועה')
          : React.createElement(React.Fragment, null,
              React.createElement('button', { style: styles.btnSecondary, onClick: handleSaveOnly }, 'שמור בלבד'),
              React.createElement('button', { style: styles.btnPrimary, onClick: handleSaveWithTx }, 'שמור וצור תנועה'),
            ),
      ),
    )
  )
}

// ─── מודאל שיוך תנועה ─────────────────────────────────────────────────────

function LinkModal({ goal, fmt, onClose, onSave }) {
  const transactions = db.prepare(`
    SELECT t.*, a.name as account_name FROM Transactions t
    LEFT JOIN Accounts a ON t.account_id = a.id
    WHERE (t.transaction_type='Savings' OR t.transaction_type='Transfer')
      AND t.savings_goal_id IS NULL
      AND t.transaction_date >= date('now', '-365 days')
    ORDER BY t.transaction_date DESC
  `).all()

  const [selected, setSelected] = useState(null)

  function handleLink() {
    if (!selected) return
    db.prepare('UPDATE Transactions SET savings_goal_id=? WHERE id=?').run(goal.id, selected)
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 500 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, `שייך תנועה ל: ${goal.name}`),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: { ...styles.modalBody, maxHeight: 400, overflowY: 'auto' } },
        transactions.length === 0
          ? React.createElement('p', { style: { color: '#94A3B8', textAlign: 'center', padding: 20 } }, 'אין תנועות מתאימות ב-365 הימים האחרונים')
          : transactions.map(tx =>
              React.createElement('div', {
                key: tx.id,
                style: {
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, marginBottom: 6, cursor: 'pointer',
                  backgroundColor: selected === tx.id ? '#EFF6FF' : '#F8FAFC',
                  border: selected === tx.id ? '1px solid #2563EB' : '1px solid #E2E8F0',
                },
                onClick: () => setSelected(tx.id),
              },
                React.createElement('input', { type: 'radio', checked: selected === tx.id, onChange: () => setSelected(tx.id) }),
                React.createElement('div', { style: { flex: 1 } },
                  React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A' } }, tx.business_entity || '—'),
                  React.createElement('p', { style: { fontSize: 11, color: '#64748B' } }, `${tx.transaction_date} | ${tx.account_name}`),
                ),
                React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: '#10B981' } }, fmt(tx.amount)),
              )
            )
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', {
          style: { ...styles.btnPrimary, opacity: !selected ? 0.5 : 1 },
          disabled: !selected,
          onClick: handleLink,
        }, 'שייך תנועה'),
      ),
    )
  )
}

function KpiCard(label, value, color) {
  return React.createElement('div', { key: label, style: styles.kpiCard },
    React.createElement('p', { style: styles.kpiLabel }, label),
    React.createElement('p', { style: { ...styles.kpiValue, color } }, value),
  )
}

function Field(label, input) {
  return React.createElement('div', { style: { marginBottom: 14 } },
    React.createElement('label', { style: { fontSize: 12, fontWeight: '500', color: '#475569', display: 'block', marginBottom: 4 } }, label),
    input,
  )
}

const styles = {
  page: { padding: 24 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
  btnSecondary: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 20 },
  kpiCard: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  kpiLabel: { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: 'bold' },
  goalsGrid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 },
  card: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 18 },
  goalName: { fontSize: 15, fontWeight: '600', color: '#0F172A', marginBottom: 4 },
  goalSub: { fontSize: 12, color: '#64748B' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60, color: '#94A3B8', textAlign: 'center' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
}

module.exports = Savings