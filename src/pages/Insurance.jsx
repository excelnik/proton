const React = require('react')
const { useState, useEffect, useMemo } = React
const db = require('../db/index.js')

function Insurance() {
  const [policies, setPolicies] = useState([])
  const [archivedPolicies, setArchivedPolicies] = useState([])
  const [showArchive, setShowArchive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [editPolicy, setEditPolicy] = useState(null)
  const [renewPolicy, setRenewPolicy] = useState(null)
  const [deletePolicy, setDeletePolicy] = useState(null)
  const [deleteMode, setDeleteMode] = useState('keep')

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

  function loadPolicies() {
    const active = db.prepare('SELECT * FROM Insurance_Policies WHERE is_active=1 ORDER BY renewal_date ASC').all()
    const archived = db.prepare('SELECT * FROM Insurance_Policies WHERE is_active=0 ORDER BY id DESC').all()
    setPolicies(active)
    setArchivedPolicies(archived)
  }

  useEffect(() => { loadPolicies() }, [])

  // סיכום עליון
  const summary = useMemo(() => {
    const annual = policies.reduce((s, p) => {
      return s + (p.payment_type === 'monthly' ? p.premium_amount * 12 : p.premium_amount)
    }, 0)
    return {
      annual,
      monthly: annual / 12,
      count: policies.length,
    }
  }, [policies])

  function handleCancel(policy) {
    if (!confirm(`האם לבטל את מעקב הפוליסה "${policy.name}"? היא תועבר לארכיון.`)) return
    db.prepare('UPDATE Insurance_Policies SET is_active=0 WHERE id=?').run(policy.id)
    loadPolicies()
  }

  function confirmDelete() {
    if (!deletePolicy) return
    if (deleteMode === 'delete') {
      db.prepare('UPDATE Transactions SET insurance_id=NULL WHERE insurance_id=?').run(deletePolicy.id)
    }
    db.prepare('DELETE FROM Insurance_Policies WHERE id=?').run(deletePolicy.id)
    setDeletePolicy(null)
    loadPolicies()
  }

  const fmt = n => '₪' + Math.abs(n).toLocaleString('he-IL', { maximumFractionDigits: 0 })

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'ביטוחים'),
      React.createElement('button', {
        style: styles.btnPrimary,
        onClick: () => { setEditPolicy(null); setRenewPolicy(null); setShowModal(true) },
      }, '+ ביטוח חדש'),
    ),

    // 3 כרטיסי סיכום
    React.createElement('div', { style: styles.grid3 },
      KpiCard('עלות שנתית כוללת', fmt(summary.annual), '#E11D48'),
      KpiCard('עלות חודשית משוערת', fmt(summary.monthly), '#F59E0B'),
      KpiCard('פוליסות פעילות', summary.count.toString(), '#2563EB'),
    ),

    // רשימת ביטוחים
    policies.length === 0
      ? React.createElement('div', { style: styles.empty },
          React.createElement('p', { style: { fontSize: 36 } }, '🛡️'),
          React.createElement('p', { style: { fontWeight: '600', color: '#475569' } }, 'אין ביטוחים פעילים'),
          React.createElement('button', {
            style: styles.btnPrimary,
            onClick: () => { setEditPolicy(null); setShowModal(true) },
          }, 'הוסף ביטוח ראשון'),
        )
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 12 } },
          policies.map(policy =>
            React.createElement(PolicyCard, {
              key: policy.id,
              policy,
              fmt,
              onEdit: () => { setEditPolicy(policy); setRenewPolicy(null); setShowModal(true) },
              onRenew: () => { setRenewPolicy(policy); setEditPolicy(null); setShowModal(true) },
              onCancel: () => handleCancel(policy),
              onDelete: () => { setDeletePolicy(policy); setDeleteMode('keep') },
            })
          )
        ),

    // ארכיון
    archivedPolicies.length > 0 && React.createElement('div', { style: { marginTop: 20 } },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' },
        onClick: () => setShowArchive(s => !s),
      },
        React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
        React.createElement('p', { style: { fontSize: 11, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' } },
          `${showArchive ? '▲' : '▼'} ארכיון (${archivedPolicies.length})`
        ),
        React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
      ),
      showArchive && archivedPolicies.map(policy =>
        React.createElement('div', { key: policy.id, style: { ...styles.card, opacity: 0.6, marginBottom: 8 } },
          React.createElement('p', { style: styles.policyName }, policy.name),
          React.createElement('p', { style: styles.policySub }, `${policy.provider_name} | ${fmt(policy.premium_amount)} / ${policy.payment_type === 'monthly' ? 'חודש' : 'שנה'}`),
        )
      ),
    ),

    // מודאל הוספה/עריכה/חידוש
    showModal && React.createElement(PolicyModal, {
      editPolicy,
      renewPolicy,
      onClose: () => { setShowModal(false); setEditPolicy(null); setRenewPolicy(null) },
      onSave: () => { setShowModal(false); setEditPolicy(null); setRenewPolicy(null); loadPolicies() },
    }),

    // מודאל מחיקה
    deletePolicy && React.createElement('div', { style: styles.overlay },
      React.createElement('div', { style: { ...styles.modal, maxWidth: 440 } },
        React.createElement('div', { style: { ...styles.modalHeader, backgroundColor: '#FEF2F2' } },
          React.createElement('h2', { style: { ...styles.modalTitle, color: '#E11D48' } }, '⚠️ מחיקת ביטוח'),
          React.createElement('button', { style: styles.closeBtn, onClick: () => setDeletePolicy(null) }, '✕'),
        ),
        React.createElement('div', { style: styles.modalBody },
          React.createElement('p', { style: { fontSize: 14, color: '#475569', marginBottom: 16 } },
            'פעולה זו תמחק את הפוליסה לחלוטין. מה לעשות עם התנועות המקושרות?'
          ),
          ['keep', 'delete'].map(mode =>
            React.createElement('label', { key: mode, style: { display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 12, cursor: 'pointer' } },
              React.createElement('input', {
                type: 'radio', name: 'deleteMode', value: mode,
                checked: deleteMode === mode,
                onChange: () => setDeleteMode(mode),
                style: { marginTop: 2 },
              }),
              React.createElement('div', null,
                React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A' } },
                  mode === 'keep' ? 'שמור תנועות בתזרים' : 'מחק את כל התנועות המקושרות'
                ),
                React.createElement('p', { style: { fontSize: 12, color: '#94A3B8' } },
                  mode === 'keep' ? 'התנועות יישארו אבל ינותקו מהביטוח' : 'מתאים לטעויות הזנה בלבד'
                ),
              )
            )
          ),
        ),
        React.createElement('div', { style: styles.modalFooter },
          React.createElement('button', { style: styles.btnSecondary, onClick: () => setDeletePolicy(null) }, 'ביטול'),
          React.createElement('button', { style: { ...styles.btnPrimary, backgroundColor: '#E11D48' }, onClick: confirmDelete }, 'מחק לצמיתות'),
        ),
      )
    ),
  )
}

// ─── כרטיס ביטוח ─────────────────────────────────────────────────────────

function PolicyCard({ policy, fmt, onEdit, onRenew, onCancel, onDelete }) {
  const renewalDate = new Date(policy.renewal_date)
  const today = new Date()
  const daysLeft = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24))
  const isUrgent = daysLeft <= 30 && daysLeft >= 0
  const isExpired = daysLeft < 0

  const annualCost = policy.payment_type === 'monthly'
    ? policy.premium_amount * 12
    : policy.premium_amount
  const monthlyCost = annualCost / 12

  return React.createElement('div', { style: styles.card },
    React.createElement('div', { style: styles.cardInner },

      // צד ימין — זהות
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('p', { style: styles.policyName }, policy.name),
        React.createElement('p', { style: styles.policySub }, policy.provider_name || 'לא צוין'),
        React.createElement('p', { style: {
          fontSize: 12, fontWeight: '500', marginTop: 4,
          color: isExpired ? '#E11D48' : isUrgent ? '#F59E0B' : '#64748B',
        }},
          isExpired
            ? `⚠️ פג תוקף לפני ${Math.abs(daysLeft)} ימים`
            : isUrgent
            ? `⏰ נותרו ${daysLeft} ימים לחידוש`
            : `חידוש: ${policy.renewal_date}`
        ),
      ),

      // קו מפריד
      React.createElement('div', { style: styles.divider }),

      // צד שמאל — פיננסי
      React.createElement('div', { style: { textAlign: 'left', minWidth: 160 } },
        React.createElement('p', { style: { fontSize: 18, fontWeight: 'bold', color: '#0F172A', marginBottom: 2 } },
          `${fmt(policy.premium_amount)} / ${policy.payment_type === 'monthly' ? 'חודש' : 'שנה'}`
        ),
        React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 8 } },
          policy.payment_type === 'monthly'
            ? `₪${Math.round(annualCost).toLocaleString('he-IL')} לשנה`
            : `₪${Math.round(monthlyCost).toLocaleString('he-IL')} לחודש`
        ),
        React.createElement('div', { style: { display: 'flex', gap: 6 } },
          React.createElement('button', { style: styles.actionBtn, onClick: onEdit, title: 'ערוך' }, '✏️'),
          React.createElement('button', { style: styles.actionBtn, onClick: onRenew, title: 'חדש' }, '🔄'),
          React.createElement('button', { style: styles.actionBtn, onClick: onCancel, title: 'בטל פוליסה' }, '✓'),
          React.createElement('button', { style: { ...styles.actionBtn, color: '#E11D48' }, onClick: onDelete, title: 'מחק' }, '🗑'),
        ),
      ),
    ),
  )
}

// ─── מודאל הוספה/עריכה/חידוש ─────────────────────────────────────────────

function PolicyModal({ editPolicy, renewPolicy, onClose, onSave }) {
  const isRenew = !!renewPolicy
  const source = renewPolicy || editPolicy

  const nextYear = new Date()
  nextYear.setFullYear(nextYear.getFullYear() + 1)
  const nextYearStr = nextYear.toISOString().slice(0, 10)

  const [form, setForm] = useState({
    name: source?.name ?? '',
    provider_name: source?.provider_name ?? '',
    premium_amount: isRenew ? '' : (source?.premium_amount?.toString() ?? ''),
    payment_type: source?.payment_type ?? 'monthly',
    renewal_date: isRenew ? nextYearStr : (source?.renewal_date ?? nextYearStr),
    recurring_id: source?.recurring_id?.toString() ?? '',
  })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // חישוב שינוי מחיר בחידוש
  const priceChange = useMemo(() => {
    if (!isRenew || !form.premium_amount || !renewPolicy.premium_amount) return null
    const oldPrice = renewPolicy.premium_amount
    const newPrice = parseFloat(form.premium_amount)
    if (isNaN(newPrice)) return null
    const pct = Math.round(((newPrice - oldPrice) / oldPrice) * 100)
    return { pct, increased: newPrice > oldPrice }
  }, [form.premium_amount, renewPolicy])

  function handleSave() {
    if (!form.name || !form.premium_amount) { setError('נא למלא שם ופרמיה'); return }

    if (isRenew) {
      // סגור פוליסה ישנה
      db.prepare('UPDATE Insurance_Policies SET is_active=0 WHERE id=?').run(renewPolicy.id)
      // צור פוליסה חדשה
      const recurringId = form.recurring_id ? parseInt(form.recurring_id) : null

      if (isRenew) {
        db.prepare(`
          INSERT INTO Insurance_Policies (name, provider_name, premium_amount, payment_type, renewal_date, recurring_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(form.name, form.provider_name, parseFloat(form.premium_amount), form.payment_type, form.renewal_date, recurringId)
      } else if (editPolicy) {
        db.prepare(`
          UPDATE Insurance_Policies SET name=?, provider_name=?, premium_amount=?, payment_type=?, renewal_date=?, recurring_id=?
          WHERE id=?
        `).run(form.name, form.provider_name, parseFloat(form.premium_amount), form.payment_type, form.renewal_date, recurringId, editPolicy.id)
      } else {
        db.prepare(`
          INSERT INTO Insurance_Policies (name, provider_name, premium_amount, payment_type, renewal_date, recurring_id, is_active)
          VALUES (?, ?, ?, ?, ?, ?, 1)
        `).run(form.name, form.provider_name, parseFloat(form.premium_amount), form.payment_type, form.renewal_date, recurringId)
      }
      onSave()
    }
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 460 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle },
          isRenew ? '🔄 חידוש ביטוח' : editPolicy ? 'עריכת ביטוח' : 'ביטוח חדש'
        ),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },

        Field('שם הפוליסה', React.createElement('input', { style: styles.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'ביטוח בריאות משלים' })),
        Field('חברה מבטחת', React.createElement('input', { style: styles.input, value: form.provider_name, onChange: e => set('provider_name', e.target.value), placeholder: 'הראל ביטוח' })),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('סוג תשלום', React.createElement('select', { style: styles.input, value: form.payment_type, onChange: e => set('payment_type', e.target.value) },
            React.createElement('option', { value: 'monthly' }, 'חודשי'),
            React.createElement('option', { value: 'annual' }, 'שנתי'),
          )),
          Field('תאריך חידוש', React.createElement('input', { style: styles.input, type: 'date', value: form.renewal_date, onChange: e => set('renewal_date', e.target.value) })),
        ),

        Field('עלות פרמיה (₪)', React.createElement('div', null,
          React.createElement('input', { style: styles.input, type: 'number', value: form.premium_amount, onChange: e => set('premium_amount', e.target.value), placeholder: isRenew ? 'הזן עלות חדשה...' : '0' }),
          isRenew && renewPolicy.premium_amount && React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginTop: 4 } },
            `עלות קודמת: ₪${renewPolicy.premium_amount.toLocaleString('he-IL')}`
          ),
          priceChange && React.createElement('p', { style: { fontSize: 12, fontWeight: '500', marginTop: 4, color: priceChange.increased ? '#E11D48' : '#10B981' } },
            priceChange.increased ? `🔴 התייקר ב-${priceChange.pct}%` : `🟢 הוזל ב-${Math.abs(priceChange.pct)}%`
          ),
        )),

        Field('הוראת קבע מקושרת', React.createElement('select', {
          style: styles.input,
          value: form.recurring_id || '',
          onChange: e => set('recurring_id', e.target.value),
        },
          React.createElement('option', { value: '' }, '— ללא —'),
          db.prepare("SELECT id, name, type FROM Recurring_Templates WHERE is_active=1 OR type='installment' ORDER BY type, name").all()
            .map(r => React.createElement('option', { key: r.id, value: r.id }, `${r.type === 'installment' ? '💳' : '🔄'} ${r.name}`))
        )),

        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnPrimary, onClick: handleSave },
          isRenew ? 'חדש פוליסה' : editPolicy ? 'שמור' : 'הוסף ביטוח'
        ),
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
  card: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  cardInner: { display: 'flex', gap: 16, alignItems: 'center' },
  policyName: { fontSize: 15, fontWeight: '600', color: '#0F172A', marginBottom: 3 },
  policySub: { fontSize: 12, color: '#64748B' },
  divider: { width: 1, backgroundColor: '#E2E8F0', alignSelf: 'stretch', flexShrink: 0 },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '3px 6px', borderRadius: 6, color: '#475569' },
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

module.exports = Insurance