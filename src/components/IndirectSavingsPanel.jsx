const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')

function IndirectSavingsPanel() {
  const today = () => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  const [rows, setRows] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ saving_date: today(), description: '', amount: '', notes: '' })
  const [error, setError] = useState('')
  function load() {
    setRows(db.prepare('SELECT * FROM Indirect_Savings ORDER BY saving_date DESC, id DESC').all())
  }
  useEffect(() => { load() }, [])
  function save() {
    const amount = Number(form.amount)
    if (!form.description.trim() || !Number.isFinite(amount) || amount <= 0) {
      setError('יש להזין תיאור וסכום חיובי')
      return
    }
    db.prepare('INSERT INTO Indirect_Savings (saving_date, description, amount, notes) VALUES (?, ?, ?, ?)')
      .run(form.saving_date || today(), form.description.trim(), amount, form.notes.trim() || null)
    setForm({ saving_date: today(), description: '', amount: '', notes: '' })
    setShowForm(false)
    setError('')
    load()
  }
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const money = n => '₪' + Number(n).toLocaleString('he-IL', { maximumFractionDigits: 2 })
  const input = { padding: '7px 9px', border: '1px solid #CBD5E1', borderRadius: 7, fontSize: 12, minWidth: 0 }
  return React.createElement('section', { style: { background: '#fff', border: '1px solid #E2E8F0', borderRadius: 14, padding: 16, marginTop: 18 } },
    React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 } },
      React.createElement('div', null,
        React.createElement('h2', { style: { margin: 0, fontSize: 16, color: '#0F172A' } }, 'חיסכון עקיף'),
        React.createElement('p', { style: { margin: '4px 0 0', fontSize: 11, color: '#64748B' } }, 'רישום ערך שנחסך בלי ליצור תנועת בנק ובלי לשנות יתרות, הכנסות או הוצאות'),
      ),
      React.createElement('div', { style: { textAlign: 'left' } },
        React.createElement('strong', { style: { display: 'block', color: '#047857', fontSize: 16 } }, money(total)),
        React.createElement('button', { style: { border: 0, borderRadius: 7, padding: '6px 10px', background: '#ECFDF5', color: '#047857', cursor: 'pointer', fontSize: 11 }, onClick: () => { setError(''); setShowForm(s => !s) } }, showForm ? 'סגור' : '+ רשומת חיסכון עקיף'),
      ),
    ),
    showForm && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: 10, background: '#F8FAFC', borderRadius: 8, marginBottom: 10 } },
      React.createElement('input', { style: input, type: 'date', value: form.saving_date, onChange: e => setForm(v => ({ ...v, saving_date: e.target.value })) }),
      React.createElement('input', { style: input, placeholder: 'תיאור החיסכון', value: form.description, onChange: e => setForm(v => ({ ...v, description: e.target.value })) }),
      React.createElement('input', { style: input, type: 'number', min: '0.01', step: '0.01', placeholder: 'סכום ₪', value: form.amount, onChange: e => setForm(v => ({ ...v, amount: e.target.value })) }),
      React.createElement('input', { style: { ...input, gridColumn: '1 / span 2' }, placeholder: 'הערות (לא חובה)', value: form.notes, onChange: e => setForm(v => ({ ...v, notes: e.target.value })) }),
      React.createElement('button', { style: { border: 0, borderRadius: 7, background: '#047857', color: '#fff', cursor: 'pointer' }, onClick: save }, 'שמור'),
      error && React.createElement('p', { style: { gridColumn: '1 / -1', color: '#B91C1C', fontSize: 11, margin: 0 } }, error),
    ),
    rows.length === 0
      ? React.createElement('p', { style: { color: '#94A3B8', fontSize: 12 } }, 'אין עדיין רשומות חיסכון עקיף')
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
          rows.map(row => React.createElement('div', { key: row.id, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid #F1F5F9', padding: '7px 0', gap: 10 } },
            React.createElement('div', null,
              React.createElement('strong', { style: { fontSize: 12, color: '#334155' } }, row.description),
              React.createElement('p', { style: { fontSize: 10, color: '#94A3B8', margin: '2px 0 0' } }, `${row.saving_date}${row.notes ? ' · ' + row.notes : ''}`),
            ),
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
              React.createElement('strong', { style: { fontSize: 12, color: '#047857' } }, money(row.amount)),
              React.createElement('button', { style: { border: 0, background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: 14 }, title: 'מחק רשומה', onClick: () => {
                if (!confirm('למחוק את רשומת החיסכון העקיף?')) return
                db.prepare('DELETE FROM Indirect_Savings WHERE id=?').run(row.id)
                load()
              } }, '×'),
            ),
          ))
        ),
  )
}

module.exports = IndirectSavingsPanel
