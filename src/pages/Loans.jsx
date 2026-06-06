const React = require('react')
const { useState, useEffect, useMemo } = React
const db = require('../db/index.js')

// ─── מנוע לוח סילוקין שפיצר ───────────────────────────────────────────────

function generateAmortization(loan) {
  const { total_amount, interest_rate, first_payment_date, duration_months, grace_period_months, grace_type } = loan
  const monthlyRate = interest_rate / 100 / 12
  const activeDuration = duration_months - (grace_period_months || 0)

  const pmt = monthlyRate === 0
    ? total_amount / activeDuration
    : (total_amount * monthlyRate * Math.pow(1 + monthlyRate, activeDuration)) /
      (Math.pow(1 + monthlyRate, activeDuration) - 1)

  let balance = total_amount
  const rows = []
  const startDate = new Date(first_payment_date)

  for (let i = 0; i < duration_months; i++) {
    const date = new Date(startDate)
    date.setMonth(date.getMonth() + i)
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

    const isGrace = i < (grace_period_months || 0)
    const interestPayment = balance * monthlyRate
    let principalPayment = 0
    let monthlyPayment = 0

    if (isGrace) {
      monthlyPayment = grace_type === 'partial' ? interestPayment : 0
      principalPayment = 0
    } else {
      monthlyPayment = pmt
      principalPayment = pmt - interestPayment
    }

    const openingBalance = balance
    balance = Math.max(0, balance - principalPayment)

    rows.push({
      month: i + 1,
      date: dateStr,
      opening_principal: openingBalance,
      monthly_payment: monthlyPayment,
      interest_payment: interestPayment,
      principal_payment: principalPayment,
      closing_principal: balance,
      is_grace: isGrace,
    })
  }
  return rows
}

function getCurrentMonthIndex(loan) {
  const today = new Date()
  const start = new Date(loan.first_payment_date)
  const months = (today.getFullYear() - start.getFullYear()) * 12 + (today.getMonth() - start.getMonth())
  return Math.max(0, Math.min(months, loan.duration_months - 1))
}

function fmt(n) { return '₪' + Math.abs(n).toLocaleString('he-IL', { maximumFractionDigits: 0 }) }

// ─── רכיב ראשי ────────────────────────────────────────────────────────────

function Loans() {
  const [loans, setLoans] = useState([])
  const [showArchive, setShowArchive] = useState(false)
  const [archivedLoans, setArchivedLoans] = useState([])
  const [selectedLoan, setSelectedLoan] = useState(null)
  const [showModal, setShowModal] = useState(false)
  const [editLoan, setEditLoan] = useState(null)
  const [showFinishModal, setShowFinishModal] = useState(false)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleteMode, setDeleteMode] = useState('keep')
  const [showAddTransaction, setShowAddTransaction] = useState(false)
  const [prefillTransaction, setPrefillTransaction] = useState(null)

  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && (e.key === 'n' || e.key === 'מ')) {
        e.preventDefault()
        setShowModal(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function loadLoans() {
    const rows = db.prepare('SELECT * FROM Liabilities WHERE is_active=1 ORDER BY id DESC').all()
    const archived = db.prepare('SELECT * FROM Liabilities WHERE is_active=0 ORDER BY id DESC').all()
    setLoans(rows)
    setArchivedLoans(archived)
  }

  useEffect(() => { loadLoans() }, [])

  // חישוב סיכום עליון
  const summary = useMemo(() => {
    let totalPrincipal = 0, totalFutureInterest = 0, totalMonthly = 0
    for (const loan of loans) {
      const schedule = generateAmortization(loan)
      const idx = getCurrentMonthIndex(loan)
      const remaining = schedule.slice(idx)
      if (remaining.length > 0) {
        totalPrincipal += remaining[0].opening_principal
        totalFutureInterest += remaining.reduce((s, r) => s + r.interest_payment, 0)
        totalMonthly += remaining[0].monthly_payment
      }
    }
    return { totalPrincipal, totalFutureInterest, totalMonthly }
  }, [loans])

  function handleFinish(loan) {
    setSelectedLoan(loan)
    setShowFinishModal(true)
  }

  function handleDelete(loan) {
    setDeleteLoan(loan)
    setShowDeleteModal(true)
  }

  function confirmDelete() {
    if (!deleteLoan) return
    if (deleteMode === 'delete') {
      db.prepare('DELETE FROM Transactions WHERE liability_id=?').run(deleteLoan.id)
    } else {
      db.prepare('UPDATE Transactions SET liability_id=NULL WHERE liability_id=?').run(deleteLoan.id)
    }
    db.prepare('DELETE FROM Liabilities WHERE id=?').run(deleteLoan.id)
    setShowDeleteModal(false)
    setDeleteLoan(null)
    if (selectedLoan?.id === deleteLoan.id) setSelectedLoan(null)
    loadLoans()
  }

  function confirmFinish(createTransaction) {
    if (!selectedLoan) return
    if (createTransaction) {
        const schedule = generateAmortization(selectedLoan)
        const idx = getCurrentMonthIndex(selectedLoan)
        const current = schedule[idx]
        if (current) {
        setPrefillTransaction({
            amount: Math.round(current.opening_principal),
            business_entity: `פירעון - ${selectedLoan.name}`,
            transaction_type: 'Expense',
            account_id: selectedLoan.account_id,
            liability_id: selectedLoan.id,
            transaction_date: new Date().toISOString().slice(0, 10),
            description: 'פירעון מוקדם',
        })
        setShowFinishModal(false)
        setShowAddTransaction(true)
        // נסיים את ההלוואה רק אחרי שהמשתמש ישמור
        return
        }
    }
    db.prepare('UPDATE Liabilities SET is_active=0 WHERE id=?').run(selectedLoan.id)
    setShowFinishModal(false)
    setSelectedLoan(null)
    loadLoans()
  }

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'מצבת חובות'),
      React.createElement('button', {
        style: styles.btnPrimary,
        onClick: () => { setEditLoan(null); setShowModal(true) },
      }, '+ הלוואה חדשה'),
    ),

    // 3 כרטיסי סיכום
    React.createElement('div', { style: styles.grid3 },
      KpiCard('יתרת קרן לתשלום', fmt(summary.totalPrincipal), '#E11D48'),
      KpiCard('ריבית עתידית', fmt(summary.totalFutureInterest), '#F59E0B'),
      KpiCard('תשלום חודשי כולל', fmt(summary.totalMonthly), '#2563EB'),
    ),

    // Split View
    React.createElement('div', { style: styles.splitView },

      // צד ימין — רשימת הלוואות
        React.createElement('div', { style: styles.loansList },
        loans.length === 0
            ? React.createElement('div', { style: styles.empty },
                React.createElement('p', { style: { fontSize: 36 } }, '📉'),
                React.createElement('p', { style: { fontWeight: '600', color: '#475569' } }, 'אין הלוואות פעילות'),
                React.createElement('button', {
                style: styles.btnPrimary,
                onClick: () => { setEditLoan(null); setShowModal(true) },
                }, 'הוסף הלוואה ראשונה'),
            )
            : loans.map(loan => React.createElement(LoanCard, {
                key: loan.id,
                loan,
                isSelected: selectedLoan?.id === loan.id,
                onSelect: () => setSelectedLoan(loan),
                onEdit: () => { setEditLoan(loan); setShowModal(true) },
                onFinish: () => handleFinish(loan),
                onDelete: () => handleDelete(loan),
            })),
        archivedLoans.length > 0 && React.createElement('div', { style: { marginTop: 16 } },
            React.createElement('div', {
            style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' },
            onClick: () => setShowArchive(s => !s),
            },
            React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
            React.createElement('p', { style: { fontSize: 11, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' } },
                `${showArchive ? '▲' : '▼'} ארכיון (${archivedLoans.length})`
            ),
            React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
            ),
            showArchive && archivedLoans.map(loan =>
            React.createElement('div', { key: loan.id, style: { ...styles.loanCard, borderColor: '#E2E8F0', opacity: 0.6, marginBottom: 8 } },
                React.createElement('p', { style: styles.loanName }, loan.name),
                React.createElement('p', { style: styles.loanSub }, `קרן: ${fmt(loan.total_amount)} | ${loan.duration_months} חודשים | ריבית: ${loan.interest_rate}%`),
            )
          ),
        ),
      ),

      // צד שמאל — לוח סילוקין
      React.createElement('div', { style: styles.amortPanel },
        !selectedLoan
          ? React.createElement('div', { style: styles.empty },
              React.createElement('p', { style: { fontSize: 32 } }, '📋'),
              React.createElement('p', { style: { color: '#94A3B8', fontSize: 14 } }, 'לחץ על הלוואה להצגת לוח הסילוקין'),
            )
          : React.createElement(AmortizationPanel, { loan: selectedLoan })
      ),
    ),

    // מודאלים
    showModal && React.createElement(LoanModal, {
      editLoan,
      onClose: () => setShowModal(false),
      onSave: () => { setShowModal(false); loadLoans() },
    }),

    showFinishModal && React.createElement(FinishModal, {
      loan: selectedLoan,
      onClose: () => setShowFinishModal(false),
      onConfirm: confirmFinish,
    }),

    showAddTransaction && prefillTransaction && React.createElement(QuickTransactionModal, {
        prefill: prefillTransaction,
        onClose: () => { setShowAddTransaction(false); setPrefillTransaction(null) },
        onSave: () => {
            // אחרי שמירה — סגור את ההלוואה
            db.prepare('UPDATE Liabilities SET is_active=0 WHERE id=?').run(selectedLoan.id)
            setShowAddTransaction(false)
            setPrefillTransaction(null)
            setSelectedLoan(null)
            loadLoans()
        },
    }),

    showDeleteModal && React.createElement('div', { style: styles.overlay },
      React.createElement('div', { style: { ...styles.modal, maxWidth: 440 } },
        React.createElement('div', { style: { ...styles.modalHeader, backgroundColor: '#FEF2F2' } },
          React.createElement('h2', { style: { ...styles.modalTitle, color: '#E11D48' } }, '⚠️ מחיקת הלוואה'),
          React.createElement('button', { style: styles.closeBtn, onClick: () => setShowDeleteModal(false) }, '✕'),
        ),
        React.createElement('div', { style: styles.modalBody },
          React.createElement('p', { style: { fontSize: 14, color: '#475569', marginBottom: 16 } },
            'פעולה זו תמחק את ההלוואה לחלוטין. מה לעשות עם תנועות העבר המקושרות?'
          ),
          ['keep', 'delete'].map(mode =>
            React.createElement('label', { key: mode, style: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio',
                name: 'deleteMode',
                value: mode,
                checked: deleteMode === mode,
                onChange: () => setDeleteMode(mode),
                style: { marginTop: 2 },
              }),
              React.createElement('div', null,
                React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A' } },
                  mode === 'keep' ? 'שמור תנועות עבר בתזרים' : 'מחק את כל התנועות המקושרות'
                ),
                React.createElement('p', { style: { fontSize: 12, color: '#94A3B8' } },
                  mode === 'keep' ? 'התנועות יישארו אבל ינותקו מההלוואה' : 'מתאים לטעויות הזנה בלבד'
                ),
              )
            )
          ),
        ),
        React.createElement('div', { style: styles.modalFooter },
          React.createElement('button', { style: styles.btnSecondary, onClick: () => setShowDeleteModal(false) }, 'ביטול'),
          React.createElement('button', {
            style: { ...styles.btnPrimary, backgroundColor: '#E11D48' },
            onClick: confirmDelete,
          }, 'מחק לצמיתות'),
        ),
      )
    ),
  )
}

// ─── כרטיס הלוואה ─────────────────────────────────────────────────────────

function LoanCard({ loan, isSelected, onSelect, onEdit, onFinish, onDelete }) {
  const schedule = useMemo(() => generateAmortization(loan), [loan.id])
  const currentIdx = getCurrentMonthIndex(loan)
  const current = schedule[currentIdx]
  const progress = Math.round((currentIdx / loan.duration_months) * 100)
  const lastPaymentDate = schedule[schedule.length - 1]?.date ?? ''

  return React.createElement('div', {
    style: {
      ...styles.loanCard,
      borderColor: isSelected ? '#2563EB' : '#E2E8F0',
      borderWidth: isSelected ? 2 : 1,
    },
    onClick: onSelect,
  },
    React.createElement('div', { style: styles.loanCardInner },

      // צד ימין — פרטים
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('p', { style: styles.loanName }, loan.name),
        React.createElement('p', { style: styles.loanSub }, `${loan.interest_rate}% ריבית שנתית`),
        React.createElement('p', { style: styles.loanSub }, `תשלום ${currentIdx + 1} מתוך ${loan.duration_months}`),
        React.createElement('p', { style: { ...styles.loanSub, fontSize: 11 } }, `תשלום אחרון: ${lastPaymentDate}`),
      ),

      // קו מפריד
      React.createElement('div', { style: styles.divider }),

      // צד שמאל — פיננסי
      React.createElement('div', { style: { textAlign: 'left', minWidth: 140 } },
        React.createElement('p', { style: styles.loanBalance }, `${fmt(current?.opening_principal ?? 0)}`),
        React.createElement('p', { style: styles.loanMonthly }, `${fmt(current?.monthly_payment ?? 0)} / חודש`),
        React.createElement('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
          React.createElement('button', {
            style: styles.actionBtn,
            onClick: e => { e.stopPropagation(); onEdit() },
            title: 'ערוך',
          }, '✏️'),
          React.createElement('button', {
            style: styles.actionBtn,
            onClick: e => { e.stopPropagation(); onFinish() },
            title: 'סיים הלוואה',
          }, '✓'),
          React.createElement('button', {
            style: { ...styles.actionBtn, color: '#E11D48' },
            onClick: e => { e.stopPropagation(); onDelete() },
            title: 'מחק',
          }, '🗑'),
        ),
      ),
    ),

    // פס התקדמות
    React.createElement('div', { style: styles.progressBar },
      React.createElement('div', { style: { ...styles.progressFill, width: `${progress}%` } })
    ),
  )
}

// ─── לוח סילוקין ──────────────────────────────────────────────────────────

function AmortizationPanel({ loan }) {
  const schedule = useMemo(() => generateAmortization(loan), [loan.id])
  const currentIdx = getCurrentMonthIndex(loan)
  // טען תנועות מקושרות
  const linkedTxs = db.prepare(`
    SELECT * FROM Transactions WHERE liability_id=? ORDER BY transaction_date
  `).all(loan.id)
  const remaining = schedule.slice(currentIdx)
  const futureInterest = remaining.reduce((s, r) => s + r.interest_payment, 0)

  return React.createElement('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } },

    // Header
    React.createElement('div', { style: styles.amortHeader },
      React.createElement('p', { style: { fontWeight: '600', fontSize: 15, color: '#0F172A', marginBottom: 8 } }, loan.name),
      React.createElement('div', { style: { display: 'flex', gap: 16 } },
        React.createElement('div', { style: styles.amortStat },
          React.createElement('p', { style: styles.amortStatLabel }, 'יתרת קרן'),
          React.createElement('p', { style: { ...styles.amortStatValue, color: '#E11D48' } },
            fmt(schedule[currentIdx]?.opening_principal ?? 0)
          ),
        ),
        React.createElement('div', { style: styles.amortStat },
          React.createElement('p', { style: styles.amortStatLabel }, 'ריבית נותרת'),
          React.createElement('p', { style: { ...styles.amortStatValue, color: '#F59E0B' } }, fmt(futureInterest)),
        ),
        React.createElement('div', { style: styles.amortStat },
          React.createElement('p', { style: styles.amortStatLabel }, 'תשלומים נותרים'),
          React.createElement('p', { style: { ...styles.amortStatValue, color: '#2563EB' } }, remaining.length),
        ),
      ),
    ),

    // טבלה
    React.createElement('div', { style: { flex: 1, overflowY: 'auto' } },
      React.createElement('table', { style: styles.table },
        React.createElement('thead', null,
          React.createElement('tr', null,
            ['תאריך', 'קרן פתיחה', 'תשלום', 'ריבית', 'קרן', 'קרן סגירה', 'תנועה מקושרת'].map(h =>
              React.createElement('th', { key: h, style: styles.th }, h)
            )
          )
        ),
        React.createElement('tbody', null,
          schedule.map((row, i) => {
            const isPast    = i < currentIdx
            const isCurrent = i === currentIdx
            return React.createElement('tr', {
              key: i,
              style: {
                backgroundColor: isCurrent ? '#EFF6FF' : isPast ? '#F8FAFC' : '#fff',
                fontWeight: isCurrent ? '600' : '400',
                opacity: isPast ? 0.5 : 1,
                borderBottom: '1px solid #F1F5F9',
              }
            },
              React.createElement('td', { style: styles.td }, row.date),
              React.createElement('td', { style: styles.td }, fmt(row.opening_principal)),
              React.createElement('td', { style: { ...styles.td, fontWeight: '500' } }, fmt(row.monthly_payment)),
              React.createElement('td', { style: { ...styles.td, color: '#F59E0B' } }, fmt(row.interest_payment)),
              React.createElement('td', { style: { ...styles.td, color: '#10B981' } }, fmt(row.principal_payment)),
              React.createElement('td', { style: styles.td }, fmt(row.closing_principal)),
              React.createElement('td', { style: styles.td }, (() => {
                const monthStr = row.date.slice(0, 7)
                const tx = linkedTxs.find(t => t.transaction_date.slice(0, 7) === monthStr)
                if (tx) {
                    return React.createElement('span', {
                    style: { color: '#10B981', fontWeight: '500', fontSize: 11 }
                    }, `✓ ₪${tx.amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`)
                }
                const isPast = row.date < new Date().toISOString().slice(0, 10)
                return React.createElement('span', {
                    style: { color: isPast ? '#E11D48' : '#94A3B8', fontSize: 11 }
                }, isPast ? '⚠ חסר' : '—')
              })()),
            )
          })
        )
      )
    ),
  )
}

// ─── מודאל הוספה/עריכה ────────────────────────────────────────────────────

function LoanModal({ editLoan, onClose, onSave }) {
  const accounts = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
  const [form, setForm] = useState({
    name: editLoan?.name ?? '',
    account_id: editLoan?.account_id ?? accounts[0]?.id ?? '',
    total_amount: editLoan?.total_amount?.toString() ?? '',
    first_payment_date: editLoan?.first_payment_date ?? new Date().toISOString().slice(0, 10),
    duration_months: editLoan?.duration_months?.toString() ?? '',
    interest_rate: editLoan?.interest_rate?.toString() ?? '0',
    grace_period_months: editLoan?.grace_period_months?.toString() ?? '0',
    grace_type: editLoan?.grace_type ?? 'none',
  })
  const [error, setError] = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // תצוגת PMT בזמן אמת
  const previewPmt = useMemo(() => {
    const principal = parseFloat(form.total_amount)
    const rate = parseFloat(form.interest_rate) / 100 / 12
    const n = parseInt(form.duration_months) - parseInt(form.grace_period_months || 0)
    if (!principal || !n || n <= 0) return null
    if (rate === 0) return principal / n
    return (principal * rate * Math.pow(1 + rate, n)) / (Math.pow(1 + rate, n) - 1)
  }, [form.total_amount, form.interest_rate, form.duration_months, form.grace_period_months])

  function handleSave() {
    if (!form.name || !form.total_amount || !form.duration_months) {
      setError('נא למלא שם, קרן ומספר תשלומים')
      return
    }
    const data = [
      form.name, parseInt(form.account_id), parseFloat(form.total_amount),
      parseFloat(form.interest_rate) || 0, form.first_payment_date,
      parseInt(form.duration_months), parseInt(form.grace_period_months) || 0,
      form.grace_type,
    ]
    if (editLoan) {
      db.prepare(`
        UPDATE Liabilities SET name=?, account_id=?, total_amount=?, interest_rate=?,
        first_payment_date=?, duration_months=?, grace_period_months=?, grace_type=?
        WHERE id=?
      `).run(...data, editLoan.id)
    } else {
      db.prepare(`
        INSERT INTO Liabilities
          (name, account_id, total_amount, interest_rate, first_payment_date,
           duration_months, grace_period_months, grace_type, start_date, is_active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, date('now'), 1)
      `).run(...data)
    }
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, editLoan ? 'עריכת הלוואה' : 'הלוואה חדשה'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },

        Field('שם ההלוואה', React.createElement('input', { style: styles.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'הלוואת רכב - פועלים' })),

        Field('חשבון מקושר', React.createElement('select', { style: styles.input, value: form.account_id, onChange: e => set('account_id', e.target.value) },
          accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
        )),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('קרן מקורית (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.total_amount, onChange: e => set('total_amount', e.target.value), placeholder: '100000' })),
          Field('ריבית שנתית (%)', React.createElement('input', { style: styles.input, type: 'number', step: '0.1', value: form.interest_rate, onChange: e => set('interest_rate', e.target.value), placeholder: '3.5' })),
        ),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('תאריך תשלום ראשון', React.createElement('input', { style: styles.input, type: 'date', value: form.first_payment_date, onChange: e => set('first_payment_date', e.target.value) })),
          Field('מספר תשלומים', React.createElement('input', { style: styles.input, type: 'number', value: form.duration_months, onChange: e => set('duration_months', e.target.value), placeholder: '60' })),
        ),

        Field('סוג גרייס', React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, alignItems: 'end' } },
            React.createElement('select', { style: styles.input, value: form.grace_type, onChange: e => set('grace_type', e.target.value) },
                React.createElement('option', { value: 'none' }, 'ללא גרייס'),
                React.createElement('option', { value: 'partial' }, 'גרייס חלקי (ריבית בלבד)'),
                React.createElement('option', { value: 'full' }, 'גרייס מלא'),
            ),
            form.grace_type !== 'none'
                ? React.createElement('div', null,
                    React.createElement('label', { style: { fontSize: 11, color: '#64748B', display: 'block', marginBottom: 3 } }, 'חודשי גרייס'),
                    React.createElement('input', {
                    style: styles.input, type: 'number',
                    value: form.grace_period_months,
                    onChange: e => set('grace_period_months', e.target.value),
                    placeholder: 'מספר חודשים',
                    }),
                )
                : React.createElement('div', null),
            )),

        previewPmt && React.createElement('div', { style: { backgroundColor: '#EFF6FF', borderRadius: 10, padding: 12, marginTop: 8 } },
          React.createElement('p', { style: { fontSize: 13, color: '#2563EB', fontWeight: '500' } },
            `תשלום חודשי משוער: ${fmt(previewPmt)}`
          ),
        ),

        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnPrimary, onClick: handleSave }, 'שמור'),
      ),
    )
  )
}

// ─── מודאל סיום הלוואה ────────────────────────────────────────────────────

function FinishModal({ loan, onClose, onConfirm }) {
  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 420 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, 'סיום הלוואה'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        React.createElement('p', { style: { fontSize: 14, color: '#475569' } },
          'האם תרצה ליצור רשומת פירעון מוקדם בתזרים?'
        ),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnSecondary, onClick: () => onConfirm(false) }, 'דלג'),
        React.createElement('button', { style: styles.btnPrimary, onClick: () => onConfirm(true) }, 'כן, צור רשומה'),
      ),
    )
  )
}

function QuickTransactionModal({ prefill, onClose, onSave }) {
  const accounts = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
  const categories = db.prepare("SELECT * FROM Categories WHERE is_active=1 AND type='Expense' ORDER BY sort_order").all()
  const [form, setForm] = useState({
    transaction_date: prefill.transaction_date,
    amount: prefill.amount.toString(),
    transaction_type: prefill.transaction_type,
    business_entity: prefill.business_entity,
    description: prefill.description || '',
    category_id: '',
    account_id: prefill.account_id,
  })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function handleSave() {
    if (!form.amount) return
    db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
         description, category_id, account_id, liability_id,
         is_budgetary, is_maaser_obligated, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 'manual')
    `).run(
      form.transaction_date, form.transaction_date, parseFloat(form.amount),
      form.transaction_type, form.business_entity,
      form.description || null, form.category_id || null,
      form.account_id, prefill.liability_id
    )
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 460 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, 'רשומת פירעון מוקדם'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 16, backgroundColor: '#EFF6FF', padding: 10, borderRadius: 8 } },
          'הנתונים ממולאים מראש לפי לוח הסילוקין. תוכל לערוך לפני השמירה.'
        ),
        Field('תאריך', React.createElement('input', { style: styles.input, type: 'date', value: form.transaction_date, onChange: e => set('transaction_date', e.target.value) })),
        Field('בית עסק / תיאור', React.createElement('input', { style: styles.input, value: form.business_entity, onChange: e => set('business_entity', e.target.value) })),
        Field('סכום (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.amount, onChange: e => set('amount', e.target.value) })),
        Field('הערות', React.createElement('input', { style: styles.input, value: form.description, onChange: e => set('description', e.target.value), placeholder: 'למשל: כולל קנס פירעון' })),
        Field('קטגוריה', React.createElement('select', { style: styles.input, value: form.category_id, onChange: e => set('category_id', e.target.value) },
          React.createElement('option', { value: '' }, 'בחר קטגוריה...'),
          categories.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.name} ${c.icon || ''}`))
        )),
        Field('חשבון', React.createElement('select', { style: styles.input, value: form.account_id, onChange: e => set('account_id', e.target.value) },
          accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
        )),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnPrimary, onClick: handleSave }, 'שמור וסגור הלוואה'),
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
  page: { padding: 24, height: '100%', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
  btnSecondary: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 },
  kpiCard: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  kpiLabel: { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: 'bold' },
  splitView: { display: 'flex', gap: 16, flex: 1, minHeight: 0 },
  loansList: { width: 340, flexShrink: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 },
  amortPanel: { flex: 1, backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', overflow: 'hidden', display: 'flex', flexDirection: 'column' },
  loanCard: { backgroundColor: '#fff', borderRadius: 12, border: '1px solid', padding: 14, cursor: 'pointer' },
  loanCardInner: { display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 10 },
  loanName: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 3 },
  loanSub: { fontSize: 12, color: '#64748B', marginBottom: 2 },
  divider: { width: 1, backgroundColor: '#E2E8F0', alignSelf: 'stretch' },
  loanBalance: { fontSize: 18, fontWeight: 'bold', color: '#E11D48', marginBottom: 2 },
  loanMonthly: { fontSize: 12, color: '#64748B', marginBottom: 6 },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '2px 6px', borderRadius: 6, color: '#475569' },
  progressBar: { height: 4, backgroundColor: '#E2E8F0', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#10B981', borderRadius: 2, transition: 'width 0.3s' },
  amortHeader: { padding: 16, borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' },
  amortStat: { textAlign: 'center' },
  amortStatLabel: { fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', marginBottom: 2 },
  amortStatValue: { fontSize: 16, fontWeight: 'bold' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'right', padding: '8px 12px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontWeight: '600', color: '#64748B', position: 'sticky', top: 0 },
  td: { padding: '7px 12px', color: '#334155' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 40, color: '#94A3B8', textAlign: 'center', height: '100%' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
}

module.exports = Loans