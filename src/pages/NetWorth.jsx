const React = require('react')
const { useState, useEffect, useMemo } = React
const db = require('../db/index.js')

// ─── חישובים ─────────────────────────────────────────────────────────────

function getAccountBalance(acc) {
  const stats = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type='Income'  THEN amount ELSE 0 END), 0) as inc,
      COALESCE(SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) as exp
    FROM Transactions WHERE account_id=?
  `).get(acc.id)
  return acc.opening_balance + stats.inc - stats.exp
}

function getSavingsGoalBalance(goal) {
  const result = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN transaction_type='Savings' THEN amount ELSE 0 END), 0) as deposits,
      COALESCE(SUM(CASE WHEN transaction_type='Expense' AND savings_goal_id IS NOT NULL THEN amount ELSE 0 END), 0) as withdrawals
    FROM Transactions WHERE savings_goal_id=?
  `).get(goal.id)
  return (goal.starting_balance || 0) + (result?.deposits || 0) - (result?.withdrawals || 0)
}

function getLoanBalance(loan) {
  const monthlyRate = loan.interest_rate / 100 / 12
  const activeDuration = loan.duration_months - (loan.grace_period_months || 0)
  const pmt = monthlyRate === 0
    ? loan.total_amount / activeDuration
    : (loan.total_amount * monthlyRate * Math.pow(1 + monthlyRate, activeDuration)) /
      (Math.pow(1 + monthlyRate, activeDuration) - 1)

  const start = new Date(loan.first_payment_date)
  const today = new Date()
  const monthsPassed = Math.max(0, Math.min(
    (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth()),
    loan.duration_months
  ))

  let balance = loan.total_amount
  for (let i = 0; i < monthsPassed; i++) {
    const isGrace = i < (loan.grace_period_months || 0)
    if (!isGrace) {
      const interest = balance * monthlyRate
      balance = Math.max(0, balance - (pmt - interest))
    }
  }
  return balance
}

function getEmergencyFundData(months) {
  const sixMonthsAgo = new Date()
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
  const from = sixMonthsAgo.toISOString().slice(0, 10)

  const totalExpenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as v FROM Transactions
    WHERE transaction_type='Expense' AND is_budgetary=1
    AND transaction_date >= ?
  `).get(from).v

  const avgMonthly = totalExpenses / 6
  const target = avgMonthly * (months || 3)

  // שאב מנכס בשם "קרן חירום"
  const emergencyAsset = db.prepare(`
    SELECT SUM(current_value * COALESCE(quantity, 1)) as v
    FROM Assets WHERE is_active=1
    AND (name LIKE '%קרן חירום%' OR name LIKE '%emergency%')
  `).get()
  const liquid = emergencyAsset?.v || 0

  return { avgMonthly, target, liquid, missing: Math.max(0, target - liquid) }
}

// ─── רכיב ראשי ────────────────────────────────────────────────────────────

function NetWorth() {
  const [accounts, setAccounts] = useState([])
  const [loans, setLoans] = useState([])
  const [savingsGoals, setSavingsGoals] = useState([])
  const [assets, setAssets] = useState([])
  const [informalDebts, setInformalDebts] = useState([])
  const [showAssetModal, setShowAssetModal] = useState(false)
  const [showDebtModal, setShowDebtModal] = useState(false)
  const [editAsset, setEditAsset] = useState(null)
  const [editDebt, setEditDebt] = useState(null)

  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'מ')) {
        e.preventDefault()
        setShowDebtModal(true)
      } else if (e.ctrlKey && (e.key === 'n' || e.key === 'מ')) {
        e.preventDefault()
        setShowAssetModal(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function loadData() {
    setAccounts(db.prepare('SELECT * FROM Accounts WHERE is_active=1').all())
    setLoans(db.prepare('SELECT * FROM Liabilities WHERE is_active=1').all())
    setSavingsGoals(db.prepare('SELECT * FROM Savings_Goals WHERE is_active=1').all())
    setAssets(db.prepare('SELECT * FROM Assets WHERE is_active=1 ORDER BY type').all())
    setInformalDebts(db.prepare('SELECT * FROM Informal_Debts WHERE is_active=1').all())
  }

  useEffect(() => { loadData() }, [])

  const calculated = useMemo(() => {
    // נכסים
    const bankAccounts = accounts.filter(a => a.type === 'Bank' || a.type === 'Cash')
    const creditCards = accounts.filter(a => a.type === 'Credit_Card')

    const bankTotal = bankAccounts.reduce((s, a) => s + Math.max(0, getAccountBalance(a)), 0)
    const overdraftTotal = bankAccounts.reduce((s, a) => {
      const bal = getAccountBalance(a)
      return s + (bal < 0 ? Math.abs(bal) : 0)
    }, 0)
    const savingsTotal = 0
    const assetsTotal = assets.reduce((s, a) => s + (a.current_value * (a.quantity || 1)), 0)
    const totalAssets = bankTotal + assetsTotal

    // התחייבויות
    const loansTotal = loans.reduce((s, l) => s + getLoanBalance(l), 0)
    const creditTotal = creditCards.reduce((s, a) => {
      const bal = getAccountBalance(a)
      return s + (bal < 0 ? Math.abs(bal) : 0)
    }, 0)
    const informalTotal = informalDebts.filter(d => d.direction === 'borrowed').reduce((s, d) => s + d.amount, 0)
    const totalLiabilities = loansTotal + creditTotal + informalTotal + overdraftTotal

    return { bankTotal, savingsTotal, assetsTotal, totalAssets, loansTotal, creditTotal, informalTotal, overdraftTotal, totalLiabilities, netWorth: totalAssets - totalLiabilities }
  }, [accounts, loans, savingsGoals, assets, informalDebts])

  const emergency = useMemo(() => {
    const row = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string='emergency_months' AND match_type='setting'"
    ).get()
    const months = parseInt(row?.cleaned_name || '3')
    return getEmergencyFundData(months)
  }, [assets, accounts])
  const fmt = n => '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL')

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'שווי נקי'),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', { style: styles.btnSecondary, onClick: () => { setEditDebt(null); setShowDebtModal(true) } }, '+ חוב זמני'),
        React.createElement('button', { style: styles.btnPrimary, onClick: () => { setEditAsset(null); setShowAssetModal(true) } }, '+ נכס'),
      ),
    ),

    // שווי נקי בולט
    React.createElement('div', { style: { ...styles.netWorthCard, borderColor: calculated.netWorth >= 0 ? '#10B981' : '#E11D48' } },
      React.createElement('p', { style: styles.netWorthLabel }, 'שווי נקי'),
      React.createElement('p', { style: { ...styles.netWorthValue, color: calculated.netWorth >= 0 ? '#10B981' : '#E11D48' } },
        `${calculated.netWorth >= 0 ? '' : '−'}${fmt(calculated.netWorth)}`
      ),
      React.createElement('div', { style: styles.netWorthRow },
        React.createElement('span', { style: { color: '#10B981', fontSize: 14 } }, `נכסים: ${fmt(calculated.totalAssets)}`),
        React.createElement('span', { style: { color: '#94A3B8' } }, '−'),
        React.createElement('span', { style: { color: '#E11D48', fontSize: 14 } }, `התחייבויות: ${fmt(calculated.totalLiabilities)}`),
      ),
    ),

    // שתי עמודות — נכסים והתחייבויות
    React.createElement('div', { style: styles.grid2 },

      // נכסים
      React.createElement('div', { style: styles.section },
        React.createElement('p', { style: styles.sectionTitle }, `נכסים — ${fmt(calculated.totalAssets)}`),

        // חשבונות בנק
        accounts.filter(a => (a.type === 'Bank' || a.type === 'Cash') && getAccountBalance(a) > 0).length > 0 &&
        React.createElement(SectionGroup, {
          title: '🏦 חשבונות בנק ומזומן',
          total: fmt(calculated.bankTotal),
          items: accounts.filter(a => (a.type === 'Bank' || a.type === 'Cash') && getAccountBalance(a) > 0).map(acc => ({
            label: acc.name,
            value: fmt(getAccountBalance(acc)),
            color: '#10B981',
          }))
        }),

        // נכסים נוספים
        assets.length > 0 && React.createElement(SectionGroup, {
          title: '📈 נכסים נוספים',
          total: fmt(calculated.assetsTotal),
          items: assets.map(a => ({
            label: `${a.name} ${a.ticker_symbol ? `(${a.ticker_symbol})` : ''}`,
            value: fmt(a.current_value * (a.quantity || 1)),
            color: '#8B5CF6',
            onEdit: () => { setEditAsset(a); setShowAssetModal(true) },
            onDelete: () => { db.prepare('UPDATE Assets SET is_active=0 WHERE id=?').run(a.id); loadData() },
          }))
        }),

        // כפתור הוספת נכס
        React.createElement('button', {
          style: { ...styles.btnSecondary, width: '100%', marginTop: 8, fontSize: 12 },
          onClick: () => { setEditAsset(null); setShowAssetModal(true) },
        }, '+ הוסף נכס'),
      ),

      // התחייבויות
      React.createElement('div', { style: styles.section },
        React.createElement('p', { style: styles.sectionTitle }, `התחייבויות — ${fmt(calculated.totalLiabilities)}`),

        // הלוואות
        loans.length > 0 && React.createElement(SectionGroup, {
        title: '📉 הלוואות',
        total: fmt(calculated.loansTotal),
        items: loans.map(l => ({
            label: l.name,
            value: fmt(getLoanBalance(l)),
            color: '#E11D48',
        }))
        }),

        // כרטיסי אשראי
        calculated.creditTotal > 0 && React.createElement(SectionGroup, {
        title: '💳 כרטיסי אשראי',
        total: fmt(calculated.creditTotal),
        items: accounts.filter(a => a.type === 'Credit_Card').map(acc => {
            const bal = getAccountBalance(acc)
            return { label: acc.name, value: fmt(Math.abs(bal < 0 ? bal : 0)), color: '#F59E0B' }
        })
        }),

        calculated.overdraftTotal > 0 && React.createElement(SectionGroup, {
            title: '🔴 אוברדראפט',
            total: fmt(calculated.overdraftTotal),
            items: accounts.filter(a => (a.type === 'Bank' || a.type === 'Cash') && getAccountBalance(a) < 0).map(acc => ({
              label: acc.name,
              value: fmt(Math.abs(getAccountBalance(acc))),
              color: '#E11D48',
          }))
        }),

        // חובות זמניים
        informalDebts.filter(d => d.direction === 'borrowed').length > 0 && React.createElement(SectionGroup, {
        title: '🤝 חובות זמניים',
        total: fmt(calculated.informalTotal),
        items: informalDebts.filter(d => d.direction === 'borrowed').map(d => ({
            label: `${d.name}${d.due_date ? ` (עד ${d.due_date})` : ''}`,
            value: fmt(d.amount),
            color: '#F59E0B',
            onEdit: () => { setEditDebt(d); setShowDebtModal(true) },
            onDelete: () => { db.prepare('UPDATE Informal_Debts SET is_active=0 WHERE id=?').run(d.id); loadData() },
        }))
        }),

        // כספים שהלוויתי
        informalDebts.filter(d => d.direction === 'lent').length > 0 &&
          React.createElement('div', { style: { marginTop: 12, padding: 12, backgroundColor: '#F0FDF4', borderRadius: 10, border: '1px solid #BBF7D0' } },
            React.createElement('p', { style: { fontSize: 12, fontWeight: '600', color: '#065F46', marginBottom: 8 } }, '💚 כספים שהלוויתי'),
            informalDebts.filter(d => d.direction === 'lent').map(d =>
              React.createElement('div', { key: d.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#065F46', marginBottom: 4 } },
                React.createElement('span', null, d.name),
                React.createElement('span', { style: { fontWeight: '600' } }, fmt(d.amount)),
              )
            )
          ),

        React.createElement('button', {
          style: { ...styles.btnSecondary, width: '100%', marginTop: 8, fontSize: 12 },
          onClick: () => { setEditDebt(null); setShowDebtModal(true) },
        }, '+ הוסף חוב זמני'),
      ),
    ),

    // ווידג'ט קרן חירום
    React.createElement('div', { style: { ...styles.emergencyCard, marginTop: 16 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 } },
        React.createElement('div', null,
          React.createElement('p', { style: { fontSize: 14, fontWeight: '600', color: '#0F172A' } }, '🛡️ קרן חירום'),
          React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginTop: 2 } },
            `יעד: ${fmt(emergency.target)} (ממוצע הוצאות חודשי: ${fmt(emergency.avgMonthly)} × ${Math.round(emergency.target / emergency.avgMonthly) || 3})`
          ),
        ),
        emergency.missing === 0
          ? React.createElement('span', { style: { backgroundColor: '#D1FAE5', color: '#065F46', fontSize: 12, fontWeight: '600', padding: '4px 10px', borderRadius: 8 } }, '✓ מוגן!')
          : React.createElement('span', { style: { backgroundColor: '#FEF3C7', color: '#92400E', fontSize: 12, fontWeight: '500', padding: '4px 10px', borderRadius: 8 } },
              `חסר ${fmt(emergency.missing)}`
            ),
      ),
      React.createElement('div', { style: { height: 10, backgroundColor: '#E2E8F0', borderRadius: 5, overflow: 'hidden', marginBottom: 6 } },
        React.createElement('div', {
          style: {
            height: '100%', borderRadius: 5,
            width: `${Math.min(100, Math.round((emergency.liquid / emergency.target) * 100) || 0)}%`,
            backgroundColor: emergency.missing === 0 ? '#10B981' : '#F59E0B',
            transition: 'width 0.4s',
          }
        })
      ),
      React.createElement('p', { style: { fontSize: 11, color: '#64748B' } },
        `נזיל: ${fmt(emergency.liquid)} מתוך יעד ${fmt(emergency.target)} (${Math.min(100, Math.round((emergency.liquid / emergency.target) * 100) || 0)}%)`
      ),
    ),

    // מודאלים
    showAssetModal && React.createElement(AssetModal, {
      editAsset,
      onClose: () => { setShowAssetModal(false); setEditAsset(null) },
      onSave: () => { setShowAssetModal(false); setEditAsset(null); loadData() },
    }),

    showDebtModal && React.createElement(InformalDebtModal, {
      editDebt,
      onClose: () => { setShowDebtModal(false); setEditDebt(null) },
      onSave: () => { setShowDebtModal(false); setEditDebt(null); loadData() },
    }),
  )
}

// ─── קומפוננטת קבוצה ──────────────────────────────────────────────────────

function SectionGroup({ title, total, items }) {
  const [open, setOpen] = useState(true)
  return React.createElement('div', { style: { marginBottom: 12 } },
    React.createElement('div', {
      style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 10px', backgroundColor: '#F8FAFC', borderRadius: 8, cursor: 'pointer', marginBottom: open ? 4 : 0 },
      onClick: () => setOpen(o => !o),
    },
      React.createElement('span', { style: { fontSize: 12, fontWeight: '600', color: '#475569' } }, title),
      React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement('span', { style: { fontSize: 13, fontWeight: '600', color: '#0F172A' } }, total),
        React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, open ? '▲' : '▼'),
      ),
    ),
    open && items.map((item, i) =>
      React.createElement('div', { key: i, style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', borderBottom: '1px solid #F1F5F9' } },
        React.createElement('span', { style: { fontSize: 13, color: '#475569' } }, item.label),
        React.createElement('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          React.createElement('span', { style: { fontSize: 13, fontWeight: '600', color: item.color } }, item.value),
          item.onEdit && React.createElement('button', { style: styles.actionBtn, onClick: item.onEdit }, '✏️'),
          item.onDelete && React.createElement('button', { style: styles.actionBtn, onClick: item.onDelete }, '🗑'),
        ),
      )
    )
  )
}

// ─── מודאל נכס ────────────────────────────────────────────────────────────

function AssetModal({ editAsset, onClose, onSave }) {
  const ASSET_TYPES = [
    { value: 'Savings', label: 'פיקדון / חיסכון' },
    { value: 'Investment', label: 'תיק השקעות' },
    { value: 'RealEstate', label: 'נדל"ן' },
    { value: 'Stock', label: 'מניות' },
    { value: 'Other', label: 'אחר' },
  ]

  const [form, setForm] = useState({
    name: editAsset?.name ?? '',
    type: editAsset?.type ?? 'Savings',
    current_value: editAsset?.current_value?.toString() ?? '',
    quantity: editAsset?.quantity?.toString() ?? '1',
    ticker_symbol: editAsset?.ticker_symbol ?? '',
  })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleSave() {
    if (!form.name || !form.current_value) { setError('נא למלא שם וערך'); return }
    if (editAsset) {
      db.prepare('UPDATE Assets SET name=?, type=?, current_value=?, quantity=?, ticker_symbol=? WHERE id=?')
        .run(form.name, form.type, parseFloat(form.current_value), parseFloat(form.quantity) || 1, form.ticker_symbol || null, editAsset.id)
    } else {
      db.prepare('INSERT INTO Assets (name, type, current_value, quantity, ticker_symbol, is_active) VALUES (?, ?, ?, ?, ?, 1)')
        .run(form.name, form.type, parseFloat(form.current_value), parseFloat(form.quantity) || 1, form.ticker_symbol || null)
    }
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 420 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, editAsset ? 'עריכת נכס' : 'נכס חדש'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        Field('שם הנכס', React.createElement('input', { style: styles.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'דירה ברחוב הרצל, תיק מניות...' })),
        Field('סוג נכס', React.createElement('select', { style: styles.input, value: form.type, onChange: e => set('type', e.target.value) },
          ASSET_TYPES.map(t => React.createElement('option', { key: t.value, value: t.value }, t.label))
        )),
        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('שווי נוכחי (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.current_value, onChange: e => set('current_value', e.target.value), placeholder: '0' })),
          Field('כמות', React.createElement('input', { style: styles.input, type: 'number', step: '0.01', value: form.quantity, onChange: e => set('quantity', e.target.value), placeholder: '1' })),
        ),
        form.type === 'Stock' && Field('סימול (Ticker)', React.createElement('input', { style: styles.input, value: form.ticker_symbol, onChange: e => set('ticker_symbol', e.target.value), placeholder: 'AAPL, MSFT...' })),
        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnPrimary, onClick: handleSave }, 'שמור'),
      ),
    )
  )
}

// ─── מודאל חוב זמני ───────────────────────────────────────────────────────

function InformalDebtModal({ editDebt, onClose, onSave }) {
  const [form, setForm] = useState({
    name: editDebt?.name ?? '',
    amount: editDebt?.amount?.toString() ?? '',
    direction: editDebt?.direction ?? 'borrowed',
    due_date: editDebt?.due_date ?? '',
    notes: editDebt?.notes ?? '',
  })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleSave() {
    if (!form.name || !form.amount) { setError('נא למלא שם וסכום'); return }
    if (editDebt) {
      db.prepare('UPDATE Informal_Debts SET name=?, amount=?, direction=?, due_date=?, notes=? WHERE id=?')
        .run(form.name, parseFloat(form.amount), form.direction, form.due_date || null, form.notes || null, editDebt.id)
    } else {
      db.prepare('INSERT INTO Informal_Debts (name, amount, direction, due_date, notes, is_active) VALUES (?, ?, ?, ?, ?, 1)')
        .run(form.name, parseFloat(form.amount), form.direction, form.due_date || null, form.notes || null)
    }
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 420 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, editDebt ? 'עריכת חוב זמני' : 'חוב זמני חדש'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        // כיוון
        React.createElement('div', { style: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 } },
          React.createElement('button', {
            style: { flex: 1, padding: '8px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: form.direction === 'borrowed' ? '#E11D48' : '#F8FAFC', color: form.direction === 'borrowed' ? '#fff' : '#475569' },
            onClick: () => set('direction', 'borrowed'),
          }, '📥 לקחתי הלוואה'),
          React.createElement('button', {
            style: { flex: 1, padding: '8px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: form.direction === 'lent' ? '#10B981' : '#F8FAFC', color: form.direction === 'lent' ? '#fff' : '#475569' },
            onClick: () => set('direction', 'lent'),
          }, '📤 הלוויתי כסף'),
        ),
        Field('שם / תיאור', React.createElement('input', { style: styles.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'הלוואה מאחי, חוב לחבר...' })),
        Field('סכום (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.amount, onChange: e => set('amount', e.target.value) })),
        Field('תאריך החזר (אופציונלי)', React.createElement('input', { style: styles.input, type: 'date', value: form.due_date, onChange: e => set('due_date', e.target.value) })),
        Field('הערות', React.createElement('input', { style: styles.input, value: form.notes, onChange: e => set('notes', e.target.value), placeholder: 'הערות נוספות...' })),
        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnPrimary, onClick: handleSave }, 'שמור'),
      ),
    )
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
  netWorthCard: { backgroundColor: '#fff', borderRadius: 16, border: '2px solid', padding: 24, textAlign: 'center', marginBottom: 20 },
  netWorthLabel: { fontSize: 12, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 },
  netWorthValue: { fontSize: 40, fontWeight: 'bold', marginBottom: 8 },
  netWorthRow: { display: 'flex', justifyContent: 'center', gap: 16, alignItems: 'center' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  section: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  sectionTitle: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #E2E8F0' },
  emergencyCard: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 4px' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
}

module.exports = NetWorth