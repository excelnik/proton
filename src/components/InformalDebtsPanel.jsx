const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')
const { listInformalDebts, createInformalDebt, recordInformalDebtPayment } = require('../lib/informalDebts.js')

const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const money = n => '₪' + Number(n || 0).toLocaleString('he-IL', { maximumFractionDigits: 2 })
const fieldStyle = { width: '100%', padding: '8px 10px', border: '1px solid #CBD5E1', borderRadius: 8, fontSize: 13, boxSizing: 'border-box' }
const btn = { border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12, cursor: 'pointer' }

function InformalDebtsPanel() {
  const [debts, setDebts] = useState([])
  const [showAdd, setShowAdd] = useState(false)
  const [repayDebt, setRepayDebt] = useState(null)
  const [form, setForm] = useState({ name: '', amount: '', direction: 'borrowed', due_date: '', notes: '' })
  const [payment, setPayment] = useState({ amount: '', payment_date: today(), transaction_id: '', notes: '' })
  const [availableTransactions, setAvailableTransactions] = useState([])
  const [error, setError] = useState('')

  function load() { setDebts(listInformalDebts(db)) }
  useEffect(() => { load() }, [])

  function saveDebt() {
    try {
      createInformalDebt(db, form)
      setForm({ name: '', amount: '', direction: 'borrowed', due_date: '', notes: '' })
      setShowAdd(false)
      setError('')
      load()
    } catch (e) { setError(e.message) }
  }

  function openRepayment(debt) {
    const type = debt.direction === 'lent' ? 'Income' : 'Expense'
    const txs = db.prepare(`
      SELECT t.id, t.transaction_date, t.amount, t.business_entity, t.description
      FROM Transactions t
      WHERE t.transaction_type=? AND NOT EXISTS (
        SELECT 1 FROM Informal_Debt_Payments p WHERE p.transaction_id=t.id
      )
      ORDER BY t.transaction_date DESC, t.id DESC
      LIMIT 500
    `).all(type)
    setAvailableTransactions(txs)
    setPayment({ amount: '', payment_date: today(), transaction_id: '', notes: '' })
    setRepayDebt(debt)
    setError('')
  }

  function savePayment() {
    try {
      recordInformalDebtPayment(db, {
        debt_id: repayDebt.id,
        amount: payment.amount,
        payment_date: payment.payment_date,
        transaction_id: payment.transaction_id || null,
        notes: payment.notes,
      })
      setRepayDebt(null)
      setError('')
      load()
    } catch (e) { setError(e.message) }
  }

  const active = debts.filter(d => d.is_active)
  const archived = debts.filter(d => !d.is_active)

  return React.createElement('section', { style: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginBottom: 16 } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 12 } },
      React.createElement('div', null,
        React.createElement('h2', { style: { margin: 0, fontSize: 16, color: '#0F172A' } }, 'הלוואות אישיות'),
        React.createElement('p', { style: { margin: '4px 0 0', fontSize: 11, color: '#64748B' } }, 'כסף שהלוות לאחרים או שקיבלת מהם — ללא חישוב ריבית'),
      ),
      React.createElement('button', { style: { ...btn, background: '#2563EB', color: '#fff' }, onClick: () => { setError(''); setShowAdd(true) } }, '+ הלוואה אישית'),
    ),
    active.length === 0
      ? React.createElement('p', { style: { color: '#94A3B8', fontSize: 12, margin: '8px 0' } }, 'אין הלוואות אישיות פעילות')
      : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 8 } },
          active.map(d => React.createElement('div', { key: d.id, style: { border: '1px solid #E2E8F0', borderRadius: 10, padding: 12 } },
            React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', gap: 8 } },
              React.createElement('strong', { style: { fontSize: 13, color: '#0F172A' } }, d.name),
              React.createElement('span', { style: { fontSize: 10, color: d.direction === 'lent' ? '#047857' : '#B45309' } }, d.direction === 'lent' ? 'הלוואה שנתתי' : 'הלוואה שקיבלתי'),
            ),
            React.createElement('p', { style: { margin: '8px 0 3px', fontSize: 12, color: '#64748B' } }, `סכום מקורי: ${money(d.amount)} · הוחזר: ${money(d.repaid_amount)}`),
            React.createElement('p', { style: { margin: '0 0 10px', fontSize: 17, fontWeight: 700, color: '#0F172A' } }, `יתרה: ${money(d.remaining_amount)}`),
            d.due_date && React.createElement('p', { style: { margin: '0 0 8px', fontSize: 11, color: '#64748B' } }, `תאריך יעד: ${d.due_date}`),
            React.createElement('button', { style: { ...btn, background: '#EFF6FF', color: '#1D4ED8' }, onClick: () => openRepayment(d) }, 'רשום החזר / קשר תנועה'),
          ))
        ),
    archived.length > 0 && React.createElement('details', { style: { marginTop: 10 } },
      React.createElement('summary', { style: { cursor: 'pointer', fontSize: 11, color: '#64748B' } }, `הלוואות שנסגרו (${archived.length})`),
      archived.map(d => React.createElement('p', { key: d.id, style: { fontSize: 11, color: '#94A3B8', margin: '6px 0' } }, `${d.name} — ${money(d.amount)}`))
    ),

    showAdd && React.createElement('div', { style: overlay },
      React.createElement('div', { style: modal },
        React.createElement('h3', { style: { margin: '0 0 14px', fontSize: 16 } }, 'הלוואה אישית חדשה'),
        React.createElement('label', { style: label }, 'שם האדם / תיאור'),
        React.createElement('input', { style: fieldStyle, value: form.name, onChange: e => setForm(v => ({ ...v, name: e.target.value })) }),
        React.createElement('label', { style: label }, 'כיוון ההלוואה'),
        React.createElement('select', { style: fieldStyle, value: form.direction, onChange: e => setForm(v => ({ ...v, direction: e.target.value })) },
          React.createElement('option', { value: 'borrowed' }, 'קיבלתי הלוואה — אני חייב להחזיר'),
          React.createElement('option', { value: 'lent' }, 'נתתי הלוואה — חייבים להחזיר לי'),
        ),
        React.createElement('label', { style: label }, 'סכום (₪)'),
        React.createElement('input', { style: fieldStyle, type: 'number', min: '0.01', step: '0.01', value: form.amount, onChange: e => setForm(v => ({ ...v, amount: e.target.value })) }),
        React.createElement('label', { style: label }, 'תאריך יעד (לא חובה)'),
        React.createElement('input', { style: fieldStyle, type: 'date', value: form.due_date, onChange: e => setForm(v => ({ ...v, due_date: e.target.value })) }),
        React.createElement('label', { style: label }, 'הערות'),
        React.createElement('textarea', { style: { ...fieldStyle, minHeight: 60 }, value: form.notes, onChange: e => setForm(v => ({ ...v, notes: e.target.value })) }),
        error && React.createElement('p', { style: errorStyle }, error),
        React.createElement('div', { style: footer },
          React.createElement('button', { style: { ...btn, background: '#F1F5F9', color: '#334155' }, onClick: () => setShowAdd(false) }, 'ביטול'),
          React.createElement('button', { style: { ...btn, background: '#2563EB', color: '#fff' }, onClick: saveDebt }, 'שמור'),
        ),
      )
    ),

    repayDebt && React.createElement('div', { style: overlay },
      React.createElement('div', { style: modal },
        React.createElement('h3', { style: { margin: '0 0 6px', fontSize: 16 } }, `החזר — ${repayDebt.name}`),
        React.createElement('p', { style: { margin: '0 0 12px', color: '#64748B', fontSize: 12 } }, `יתרה נוכחית: ${money(repayDebt.remaining_amount)}`),
        React.createElement('label', { style: label }, 'סכום החזר (₪)'),
        React.createElement('input', { style: fieldStyle, type: 'number', min: '0.01', step: '0.01', value: payment.amount, onChange: e => setPayment(v => ({ ...v, amount: e.target.value, transaction_id: '' })) }),
        React.createElement('label', { style: label }, 'תאריך החזר'),
        React.createElement('input', { style: fieldStyle, type: 'date', value: payment.payment_date, onChange: e => setPayment(v => ({ ...v, payment_date: e.target.value })) }),
        React.createElement('label', { style: label }, 'קישור לתנועה קיימת (אופציונלי)'),
        React.createElement('select', { style: fieldStyle, value: payment.transaction_id, onChange: e => {
          const tx = availableTransactions.find(t => String(t.id) === e.target.value)
          setPayment(v => ({ ...v, transaction_id: e.target.value, amount: tx ? String(tx.amount) : v.amount, payment_date: tx ? tx.transaction_date : v.payment_date }))
        } },
          React.createElement('option', { value: '' }, 'ללא קישור — רישום ידני בלבד'),
          availableTransactions.map(t => React.createElement('option', { key: t.id, value: String(t.id) }, `#${t.id} · ${t.transaction_date} · ${money(t.amount)} · ${t.business_entity || t.description || 'תנועה'}`)),
        ),
        React.createElement('label', { style: label }, 'הערות'),
        React.createElement('textarea', { style: { ...fieldStyle, minHeight: 55 }, value: payment.notes, onChange: e => setPayment(v => ({ ...v, notes: e.target.value })) }),
        error && React.createElement('p', { style: errorStyle }, error),
        React.createElement('div', { style: footer },
          React.createElement('button', { style: { ...btn, background: '#F1F5F9', color: '#334155' }, onClick: () => setRepayDebt(null) }, 'ביטול'),
          React.createElement('button', { style: { ...btn, background: '#2563EB', color: '#fff' }, onClick: savePayment }, 'שמור החזר'),
        ),
      )
    ),
  )
}

const overlay = { position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1200, padding: 16 }
const modal = { width: '100%', maxWidth: 440, maxHeight: '90vh', overflowY: 'auto', background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 20px 50px rgba(0,0,0,.2)' }
const label = { display: 'block', fontSize: 12, color: '#475569', margin: '10px 0 5px' }
const footer = { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }
const errorStyle = { color: '#B91C1C', fontSize: 12, margin: '10px 0 0' }

module.exports = InformalDebtsPanel
