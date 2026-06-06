const React = require('react')
const { useState, useEffect, useMemo } = React
const db = require('../db/index.js')

function Recurring() {
  const [tab, setTab] = useState('recurring')
  const [templates, setTemplates] = useState([])
  const [archived, setArchived] = useState([])
  const [showArchive, setShowArchive] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [modalType, setModalType] = useState('recurring')
  const [editTemplate, setEditTemplate] = useState(null)
  const [finishTemplate, setFinishTemplate] = useState(null)
  const [deleteTemplate, setDeleteTemplate] = useState(null)
  const [deleteMode, setDeleteMode] = useState('keep')
  const [linkTemplate, setLinkTemplate] = useState(null)

  useEffect(() => {
    const handler = e => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'מ')) {
        e.preventDefault()
        setModalType('installment')
        setEditTemplate(null)
        setShowModal(true)
      } else if (e.ctrlKey && (e.key === 'n' || e.key === 'מ')) {
        e.preventDefault()
        setModalType('recurring')
        setEditTemplate(null)
        setShowModal(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  function loadTemplates() {
    const active = db.prepare(`
      SELECT t.*, c.name as category_name, c.icon as category_icon, a.name as account_name
      FROM Recurring_Templates t
      LEFT JOIN Categories c ON t.category_id=c.id
      LEFT JOIN Accounts a ON t.account_id=a.id
      WHERE t.is_active=1
      ORDER BY t.id DESC
    `).all()
    const arch = db.prepare(`
      SELECT t.*, c.name as category_name, a.name as account_name
      FROM Recurring_Templates t
      LEFT JOIN Categories c ON t.category_id=c.id
      LEFT JOIN Accounts a ON t.account_id=a.id
      WHERE t.is_active=0
      ORDER BY t.id DESC
    `).all()
    setTemplates(active)
    setArchived(arch)
  }

  useEffect(() => { loadTemplates() }, [])

  const recurring = templates.filter(t => t.type === 'recurring')
  const installments = templates.filter(t => t.type === 'installment')

  const summary = useMemo(() => {
    if (tab === 'recurring') {
      const monthly = recurring.reduce((s, t) => {
        if (t.frequency === 'monthly') return s + t.amount
        if (t.frequency === 'quarterly') return s + t.amount / 3
        if (t.frequency === 'annual') return s + t.amount / 12
        return s
      }, 0)
      const annual = monthly * 12
      return {
        s1: { label: 'סך התחייבויות חודשיות', value: '₪' + Math.round(monthly).toLocaleString('he-IL'), color: '#E11D48' },
        s2: { label: 'עלות שנתית', value: '₪' + Math.round(annual).toLocaleString('he-IL'), color: '#F59E0B' },
        s3: { label: 'הוראות קבע פעילות', value: recurring.length.toString(), color: '#2563EB' },
      }
    } else {
      const totalDebt = installments.reduce((s, t) => s + t.amount * (t.num_installments - (t.installments_paid || 0)), 0)
      const monthlyDrop = installments.reduce((s, t) => s + t.amount, 0)
      return {
        s1: { label: 'יתרת חוב כוללת', value: '₪' + Math.round(totalDebt).toLocaleString('he-IL'), color: '#E11D48' },
        s2: { label: 'ירידה חודשית', value: '₪' + Math.round(monthlyDrop).toLocaleString('he-IL'), color: '#F59E0B' },
        s3: { label: 'עסקאות פעילות', value: installments.length.toString(), color: '#2563EB' },
      }
    }
  }, [tab, templates])

  function confirmDelete() {
    if (!deleteTemplate) return
    if (deleteMode === 'delete') {
      db.prepare('DELETE FROM Transactions WHERE recurring_id=?').run(deleteTemplate.id)
    } else {
      db.prepare('UPDATE Transactions SET recurring_id=NULL WHERE recurring_id=?').run(deleteTemplate.id)
    }
    db.prepare('DELETE FROM Recurring_Templates WHERE id=?').run(deleteTemplate.id)
    setDeleteTemplate(null)
    loadTemplates()
  }

  const currentList = tab === 'recurring' ? recurring : installments
  const fmt = n => '₪' + Math.abs(Math.round(n)).toLocaleString('he-IL')

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'תשלומים והוראות קבע'),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', {
          style: styles.btnSecondary,
          onClick: () => { setModalType('recurring'); setEditTemplate(null); setShowModal(true) },
        }, '+ הוראת קבע'),
        React.createElement('button', {
          style: styles.btnPrimary,
          onClick: () => { setModalType('installment'); setEditTemplate(null); setShowModal(true) },
        }, '+ עסקת תשלומים'),
      ),
    ),

    // כרטיסי סיכום
    React.createElement('div', { style: styles.grid3 },
      KpiCard(summary.s1.label, summary.s1.value, summary.s1.color),
      KpiCard(summary.s2.label, summary.s2.value, summary.s2.color),
      KpiCard(summary.s3.label, summary.s3.value, summary.s3.color),
    ),

    // מתג
    React.createElement('div', { style: styles.segmented },
      React.createElement('button', {
        style: { ...styles.segBtn, ...(tab === 'recurring' ? styles.segBtnActive : {}) },
        onClick: () => setTab('recurring'),
      }, `הוראות קבע (${recurring.length})`),
      React.createElement('button', {
        style: { ...styles.segBtn, ...(tab === 'installment' ? styles.segBtnActive : {}) },
        onClick: () => setTab('installment'),
      }, `עסקאות בתשלומים (${installments.length})`),
    ),

    // רשימה
    currentList.length === 0
      ? React.createElement('div', { style: styles.empty },
          React.createElement('p', { style: { fontSize: 32 } }, tab === 'recurring' ? '📋' : '💳'),
          React.createElement('p', { style: { color: '#475569', fontWeight: '600' } },
            tab === 'recurring' ? 'אין הוראות קבע' : 'אין עסקאות בתשלומים'
          ),
        )
      : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
          currentList.map(t =>
            tab === 'recurring'
              ? React.createElement(RecurringCard, {
                key: t.id, template: t, fmt,
                onEdit: () => { setEditTemplate(t); setModalType('recurring'); setShowModal(true) },
                onArchive: () => { db.prepare('UPDATE Recurring_Templates SET is_active=0 WHERE id=?').run(t.id); loadTemplates() },
                onDelete: () => { setDeleteTemplate(t); setDeleteMode('keep') },
                onLink: () => setLinkTemplate(t),
              })
              : React.createElement(InstallmentCard, {
                  key: t.id, template: t, fmt,
                  onEdit: () => { setEditTemplate(t); setModalType('installment'); setShowModal(true) },
                  onFinish: () => setFinishTemplate(t),
                  onDelete: () => { setDeleteTemplate(t); setDeleteMode('keep') },
                  onLink: () => setLinkTemplate(t),
                  onReload: loadTemplates,
                })
          )
        ),

    // ארכיון
    archived.length > 0 && React.createElement('div', { style: { marginTop: 20 } },
      React.createElement('div', {
        style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, cursor: 'pointer' },
        onClick: () => setShowArchive(s => !s),
      },
        React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
        React.createElement('p', { style: { fontSize: 11, fontWeight: '600', color: '#94A3B8', textTransform: 'uppercase', whiteSpace: 'nowrap' } },
          `${showArchive ? '▲' : '▼'} ארכיון (${archived.length})`
        ),
        React.createElement('div', { style: { flex: 1, height: 1, backgroundColor: '#E2E8F0' } }),
      ),
      showArchive && archived.map(t =>
        React.createElement('div', { key: t.id, style: { ...styles.card, opacity: 0.5, marginBottom: 8, padding: '10px 14px' } },
          React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
            React.createElement('div', null,
              React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: '#475569' } }, t.name),
              React.createElement('p', { style: { fontSize: 11, color: '#94A3B8' } },
                `${t.type === 'recurring' ? 'הוראת קבע' : 'תשלומים'} | ${fmt(t.amount)}`
              ),
            ),
            React.createElement('button', {
              style: { ...styles.actionBtn, fontSize: 11, color: '#E11D48' },
              onClick: () => { setDeleteTemplate(t); setDeleteMode('keep') },
            }, '🗑'),
          )
        )
      ),
    ),

    // מודאל הוספה/עריכה
    showModal && React.createElement(TemplateModal, {
      type: modalType,
      editTemplate,
      onClose: () => { setShowModal(false); setEditTemplate(null) },
      onSave: () => { setShowModal(false); setEditTemplate(null); loadTemplates() },
    }),

    // מודאל סיום מוקדם
    finishTemplate && React.createElement(FinishModal, {
      template: finishTemplate,
      fmt,
      onClose: () => setFinishTemplate(null),
      onSave: () => { setFinishTemplate(null); loadTemplates() },
    }),

    // מודאל מחיקה
    deleteTemplate && React.createElement('div', { style: styles.overlay },
      React.createElement('div', { style: { ...styles.modal, maxWidth: 440 } },
        React.createElement('div', { style: { ...styles.modalHeader, backgroundColor: '#FEF2F2' } },
          React.createElement('h2', { style: { ...styles.modalTitle, color: '#E11D48' } }, '⚠️ מחיקה'),
          React.createElement('button', { style: styles.closeBtn, onClick: () => setDeleteTemplate(null) }, '✕'),
        ),
        React.createElement('div', { style: styles.modalBody },
          React.createElement('p', { style: { fontSize: 14, color: '#475569', marginBottom: 16 } },
            `מה לעשות עם התנועות המקושרות ל-"${deleteTemplate.name}"?`
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
                  mode === 'keep' ? 'שמור תנועות — נתק מהתבנית' : 'מחק גם את התנועות המקושרות'
                ),
                React.createElement('p', { style: { fontSize: 12, color: '#94A3B8' } },
                  mode === 'keep' ? 'התנועות יישארו בתזרים ללא שיוך' : 'מתאים לטעויות הזנה בלבד'
                ),
              )
            )
          ),
        ),
        React.createElement('div', { style: styles.modalFooter },
          React.createElement('button', { style: styles.btnSecondary, onClick: () => setDeleteTemplate(null) }, 'ביטול'),
          React.createElement('button', { style: { ...styles.btnPrimary, backgroundColor: '#E11D48' }, onClick: confirmDelete }, 'מחק'),
        ),
      )
    ),
    linkTemplate && React.createElement(LinkTransactionsModal, {
      template: linkTemplate,
      fmt,
      onClose: () => setLinkTemplate(null),
      onSave: () => { setLinkTemplate(null); loadTemplates() },
    }),
  )
}

// ─── כרטיס הוראת קבע ─────────────────────────────────────────────────────

function RecurringCard({ template: t, fmt, onEdit, onArchive, onDelete, onLink }) {
  const [showTxs, setShowTxs] = useState(false)
  const freqLabel = { monthly: 'חודשי', quarterly: 'רבעוני', annual: 'שנתי' }[t.frequency] || 'חודשי'

  const linkedTxs = showTxs ? db.prepare(`
    SELECT * FROM Transactions WHERE recurring_id=? ORDER BY transaction_date DESC LIMIT 12
  `).all(t.id) : []

  return React.createElement('div', { style: styles.card },
    React.createElement('div', { style: styles.cardInner },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('p', { style: styles.cardName }, t.name),
        React.createElement('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 2 } },
          t.category_name && React.createElement('span', { style: styles.badge },
            `${t.category_icon || ''} ${t.category_name}`
          ),
          t.insurance_id && React.createElement('span', { style: { ...styles.badge, backgroundColor: '#DBEAFE', color: '#1D4ED8' } },
            '🛡️ מקושר לביטוח'
          ),
        ),
        React.createElement('p', { style: styles.cardSub }, `${freqLabel}, ב-${t.charge_day || 1} לחודש`),
      ),
      React.createElement('div', { style: { textAlign: 'left', minWidth: 140 } },
        React.createElement('p', { style: { fontSize: 16, fontWeight: 'bold', color: '#0F172A', marginBottom: 2 } },
          `${t.is_estimated ? '~' : ''}${fmt(t.amount)}`
        ),
        t.is_estimated && React.createElement('p', { style: { fontSize: 10, color: '#94A3B8' } }, 'סכום משוער'),
        React.createElement('p', { style: styles.cardSub }, t.account_name || '—'),
        React.createElement('div', { style: { display: 'flex', gap: 4, marginTop: 6 } },
          React.createElement('button', { style: styles.actionBtn, onClick: onEdit }, '✏️'),
          React.createElement('button', { style: styles.actionBtn, onClick: onArchive, title: 'העבר לארכיון' }, '📁'),
          React.createElement('button', { style: { ...styles.actionBtn, color: '#2563EB' }, onClick: onLink, title: 'שייך רשומות' }, '🔗'),
          React.createElement('button', { style: { ...styles.actionBtn, color: '#E11D48' }, onClick: onDelete }, '🗑'),
        ),
      ),
    ),

    // אקורדיון תנועות מקושרות
    React.createElement('div', {
      style: { marginTop: 8, paddingTop: 8, borderTop: '1px solid #F1F5F9', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      onClick: () => setShowTxs(s => !s),
    },
      React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, 'תנועות מקושרות'),
      React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, showTxs ? '▲' : '▼'),
    ),
    showTxs && React.createElement('div', { style: { marginTop: 6, maxHeight: 160, overflowY: 'auto' } },
      linkedTxs.length === 0
        ? React.createElement('p', { style: { fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 8 } }, 'אין תנועות מקושרות עדיין')
        : linkedTxs.map(tx =>
            React.createElement('div', { key: tx.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #F8FAFC' } },
              React.createElement('span', { style: { color: '#475569' } }, tx.transaction_date),
              React.createElement('span', { style: { color: '#475569' } }, tx.business_entity || '—'),
              React.createElement('span', { style: { color: '#E11D48', fontWeight: '500' } }, `−${fmt(tx.amount)}`),
            )
          )
    ),
  )
}

// ─── כרטיס עסקת תשלומים ──────────────────────────────────────────────────

function InstallmentCard({ template: t, fmt, onEdit, onFinish, onDelete, onLink }) {
  const [showTxs, setShowTxs] = useState(false)
  const paid = t.installments_paid || 0
  const total = t.num_installments || 1
  const progress = Math.round((paid / total) * 100)
  const remainingAmount = t.amount * (total - paid)

  const linkedTxs = showTxs ? db.prepare(`
    SELECT * FROM Transactions WHERE recurring_id=? ORDER BY transaction_date DESC
  `).all(t.id) : []

  return React.createElement('div', { style: styles.card },
    React.createElement('div', { style: styles.cardInner },
      React.createElement('div', { style: { flex: 1 } },
        React.createElement('p', { style: styles.cardName }, t.name),
        React.createElement('p', { style: styles.cardSub }, t.account_name || '—'),
        React.createElement('p', { style: styles.cardSub }, `תשלום ${paid + 1} מתוך ${total}`),
      ),
      React.createElement('div', { style: { textAlign: 'left', minWidth: 160 } },
        React.createElement('p', { style: { fontSize: 15, fontWeight: 'bold', color: '#0F172A', marginBottom: 2 } },
          `${fmt(t.amount)} / תשלום`
        ),
        React.createElement('p', { style: { fontSize: 12, color: '#E11D48', marginBottom: 6 } },
          `נותרו ${fmt(remainingAmount)}`
        ),
        React.createElement('div', { style: { display: 'flex', gap: 4 } },
          React.createElement('button', { style: styles.actionBtn, onClick: onEdit }, '✏️'),
          React.createElement('button', { style: { ...styles.actionBtn, color: '#2563EB' }, onClick: onLink, title: 'שייך רשומות' }, '🔗'),
          React.createElement('button', { style: styles.actionBtn, onClick: onFinish, title: 'סיים מוקדם' }, '✓'),
          React.createElement('button', { style: { ...styles.actionBtn, color: '#E11D48' }, onClick: onDelete }, '🗑'),
        ),
      ),
    ),

    // פס התקדמות
    React.createElement('div', { style: { marginTop: 8 } },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#64748B', marginBottom: 3 } },
        React.createElement('span', null, `שולם: ${fmt(t.amount * paid)}`),
        React.createElement('span', null, `${progress}%`),
      ),
      React.createElement('div', { style: { height: 5, backgroundColor: '#E2E8F0', borderRadius: 3, overflow: 'hidden' } },
        React.createElement('div', { style: { height: '100%', borderRadius: 3, backgroundColor: '#10B981', width: `${progress}%` } })
      ),
    ),

    // אקורדיון
    React.createElement('div', {
      style: { marginTop: 8, paddingTop: 8, borderTop: '1px solid #F1F5F9', cursor: 'pointer', display: 'flex', justifyContent: 'space-between' },
      onClick: () => setShowTxs(s => !s),
    },
      React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, 'תנועות מקושרות'),
      React.createElement('span', { style: { fontSize: 11, color: '#94A3B8' } }, showTxs ? '▲' : '▼'),
    ),
    showTxs && React.createElement('div', { style: { marginTop: 6, maxHeight: 160, overflowY: 'auto' } },
      linkedTxs.length === 0
        ? React.createElement('p', { style: { fontSize: 12, color: '#94A3B8', textAlign: 'center', padding: 8 } }, 'אין תנועות מקושרות עדיין')
        : linkedTxs.map(tx =>
            React.createElement('div', { key: tx.id, style: { display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '4px 0', borderBottom: '1px solid #F8FAFC' } },
              React.createElement('span', { style: { color: '#475569' } }, tx.transaction_date),
              React.createElement('span', { style: { color: '#475569' } }, tx.business_entity || '—'),
              React.createElement('span', { style: { color: '#E11D48', fontWeight: '500' } }, `−${fmt(tx.amount)}`),
            )
          )
    ),
  )
}

// ─── מודאל סיום מוקדם ─────────────────────────────────────────────────────

function FinishModal({ template, fmt, onClose, onSave }) {
  const accounts = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
  const [step, setStep] = useState('ask') // ask → create/link → done
  const [createTx, setCreateTx] = useState(null)
  const [selected, setSelected] = useState(null)
  const [txForm, setTxForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    amount: (template.amount * ((template.num_installments || 1) - (template.installments_paid || 0))).toString(),
    account_id: template.account_id?.toString() ?? '',
    description: `פירעון מוקדם — ${template.name}`,
  })

  const linkableTxs = db.prepare(`
    SELECT t.*, a.name as account_name FROM Transactions t
    LEFT JOIN Accounts a ON t.account_id=a.id
    WHERE t.recurring_id IS NULL AND t.transaction_type='Expense'
    AND t.transaction_date >= date('now', '-30 days')
    ORDER BY t.transaction_date DESC
  `).all()

  function handleFinish() {
    db.prepare('UPDATE Recurring_Templates SET is_active=0 WHERE id=?').run(template.id)
    onSave()
  }

  function handleCreateTx() {
    db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
         description, account_id, recurring_id, is_budgetary, is_maaser_obligated, source)
      VALUES (?, ?, ?, 'Expense', ?, ?, ?, ?, 1, 0, 'manual')
    `).run(
      txForm.date, txForm.date,
      parseFloat(txForm.amount),
      template.name, txForm.description,
      txForm.account_id, template.id
    )
    handleFinish()
  }

  function handleLink() {
    if (!selected) return
    db.prepare('UPDATE Transactions SET recurring_id=? WHERE id=?').run(template.id, selected)
    handleFinish()
  }

  if (step === 'ask') {
    return React.createElement('div', { style: styles.overlay },
      React.createElement('div', { style: { ...styles.modal, maxWidth: 420 } },
        React.createElement('div', { style: styles.modalHeader },
          React.createElement('h2', { style: styles.modalTitle }, 'סיום מוקדם'),
          React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
        ),
        React.createElement('div', { style: styles.modalBody },
          React.createElement('p', { style: { fontSize: 14, color: '#475569', marginBottom: 16 } },
            `האם ליצור רשומת פירעון עבור "${template.name}"?`
          ),
        ),
        React.createElement('div', { style: styles.modalFooter },
          React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
          React.createElement('button', { style: styles.btnSecondary, onClick: handleFinish }, 'דלג'),
          React.createElement('button', { style: styles.btnSecondary, onClick: () => setStep('link') }, 'שייך קיימת'),
          React.createElement('button', { style: styles.btnPrimary, onClick: () => setStep('create') }, 'צור רשומה'),
        ),
      )
    )
  }

  if (step === 'create') {
    return React.createElement('div', { style: styles.overlay },
      React.createElement('div', { style: { ...styles.modal, maxWidth: 420 } },
        React.createElement('div', { style: styles.modalHeader },
          React.createElement('h2', { style: styles.modalTitle }, 'יצירת רשומת פירעון'),
          React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
        ),
        React.createElement('div', { style: styles.modalBody },
          Field('תאריך', React.createElement('input', { style: styles.input, type: 'date', value: txForm.date, onChange: e => setTxForm(f => ({ ...f, date: e.target.value })) })),
          Field('סכום (₪)', React.createElement('input', { style: styles.input, type: 'number', value: txForm.amount, onChange: e => setTxForm(f => ({ ...f, amount: e.target.value })) })),
          Field('חשבון', React.createElement('select', { style: styles.input, value: txForm.account_id, onChange: e => setTxForm(f => ({ ...f, account_id: e.target.value })) },
            accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
          )),
          Field('הערות', React.createElement('input', { style: styles.input, value: txForm.description, onChange: e => setTxForm(f => ({ ...f, description: e.target.value })) })),
        ),
        React.createElement('div', { style: styles.modalFooter },
          React.createElement('button', { style: styles.btnSecondary, onClick: () => setStep('ask') }, 'חזור'),
          React.createElement('button', { style: styles.btnPrimary, onClick: handleCreateTx }, 'שמור וסיים'),
        ),
      )
    )
  }

  if (step === 'link') {
    return React.createElement('div', { style: styles.overlay },
      React.createElement('div', { style: { ...styles.modal, maxWidth: 480 } },
        React.createElement('div', { style: styles.modalHeader },
          React.createElement('h2', { style: styles.modalTitle }, 'שייך תנועה קיימת'),
          React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
        ),
        React.createElement('div', { style: { ...styles.modalBody, maxHeight: 350, overflowY: 'auto' } },
          linkableTxs.length === 0
            ? React.createElement('p', { style: { color: '#94A3B8', textAlign: 'center', padding: 20 } }, 'אין תנועות מתאימות ב-30 הימים האחרונים')
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
                    React.createElement('p', { style: { fontSize: 13, fontWeight: '500' } }, tx.business_entity || '—'),
                    React.createElement('p', { style: { fontSize: 11, color: '#64748B' } }, `${tx.transaction_date} | ${tx.account_name}`),
                  ),
                  React.createElement('span', { style: { fontSize: 13, fontWeight: '600', color: '#E11D48' } }, `−₪${tx.amount.toLocaleString('he-IL', { maximumFractionDigits: 0 })}`),
                )
              )
        ),
        React.createElement('div', { style: styles.modalFooter },
          React.createElement('button', { style: styles.btnSecondary, onClick: () => setStep('ask') }, 'חזור'),
          React.createElement('button', {
            style: { ...styles.btnPrimary, opacity: !selected ? 0.5 : 1 },
            disabled: !selected,
            onClick: handleLink,
          }, 'שייך וסיים'),
        ),
      )
    )
  }

  return null
}

// ─── מודאל הוספה/עריכה ────────────────────────────────────────────────────

function TemplateModal({ type, editTemplate, onClose, onSave }) {
  const accounts = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
  const categories = db.prepare("SELECT * FROM Categories WHERE is_active=1 AND type='Expense' ORDER BY sort_order").all()

  const [form, setForm] = useState({
    name: editTemplate?.name ?? '',
    amount: editTemplate?.amount?.toString() ?? '',
    frequency: editTemplate?.frequency ?? 'monthly',
    charge_day: editTemplate?.charge_day?.toString() ?? '1',
    first_charge_date: editTemplate?.first_charge_date ?? new Date().toISOString().slice(0, 10),
    account_id: editTemplate?.account_id?.toString() ?? accounts[0]?.id?.toString() ?? '',
    category_id: editTemplate?.category_id?.toString() ?? '',
    is_estimated: editTemplate?.is_estimated ?? 0,
    is_budgetary: editTemplate?.is_budgetary ?? 1,
    is_maaser_obligated: editTemplate?.is_maaser_obligated ?? 1,
    num_installments: editTemplate?.num_installments?.toString() ?? '',
    total_amount: editTemplate?.total_amount?.toString() ?? '',
    notes: editTemplate?.notes ?? '',
  })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const installmentAmount = useMemo(() => {
    if (type !== 'installment') return null
    const total = parseFloat(form.total_amount)
    const num = parseInt(form.num_installments)
    if (total && num) return Math.round(total / num)
    return null
  }, [form.total_amount, form.num_installments])

  function saveTemplate(withVirtual) {
    if (!form.name) { setError('נא למלא שם'); return }
    if (type === 'installment' && (!form.total_amount || !form.num_installments)) {
      setError('נא למלא סכום כולל ומספר תשלומים'); return
    }
    if (type === 'recurring' && !form.amount) { setError('נא למלא סכום'); return }

    const amount = type === 'installment'
      ? (installmentAmount || parseFloat(form.amount))
      : parseFloat(form.amount)

    const payload = JSON.stringify({
      is_budgetary: form.is_budgetary ? 1 : 0,
      is_maaser_obligated: form.is_maaser_obligated ? 1 : 0,
      notes: form.notes,
    })

    if (editTemplate) {
      db.prepare(`
        UPDATE Recurring_Templates SET
          name=?, type=?, amount=?, frequency=?, charge_day=?, first_charge_date=?,
          account_id=?, category_id=?, is_estimated=?, is_budgetary=?, is_maaser_obligated=?,
          num_installments=?, total_amount=?, template_payload=?, notes=?
        WHERE id=?
      `).run(
        form.name, type, amount, form.frequency, parseInt(form.charge_day) || 1, form.first_charge_date,
        form.account_id || null, form.category_id || null,
        form.is_estimated ? 1 : 0, form.is_budgetary ? 1 : 0, form.is_maaser_obligated ? 1 : 0,
        type === 'installment' ? parseInt(form.num_installments) : null,
        type === 'installment' ? parseFloat(form.total_amount) : null,
        payload, form.notes || null, editTemplate.id
      )
    } else {
      db.prepare(`
        INSERT INTO Recurring_Templates
          (name, type, amount, frequency, charge_day, first_charge_date,
           account_id, category_id, is_estimated, is_budgetary, is_maaser_obligated,
           num_installments, total_amount, template_payload, notes, is_active, installments_paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
      `).run(
        form.name, type, amount, form.frequency, parseInt(form.charge_day) || 1, form.first_charge_date,
        form.account_id || null, form.category_id || null,
        form.is_estimated ? 1 : 0, form.is_budgetary ? 1 : 0, form.is_maaser_obligated ? 1 : 0,
        type === 'installment' ? parseInt(form.num_installments) : null,
        type === 'installment' ? parseFloat(form.total_amount) : null,
        payload, form.notes || null
      )
    }

    if (withVirtual) {
      alert(`✓ נוצרו תנועות וירטואליות ל-12 חודשים הקרובים`)
    }
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 500, maxHeight: '90vh', overflowY: 'auto' } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle },
          editTemplate
            ? `עריכת ${type === 'recurring' ? 'הוראת קבע' : 'עסקת תשלומים'}`
            : type === 'recurring' ? 'הוראת קבע חדשה' : 'עסקת תשלומים חדשה'
        ),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },

        Field('שם העסקה', React.createElement('input', { style: styles.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: type === 'recurring' ? 'ארנונה, חשמל...' : 'מקרר סמסונג...' })),

        React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('חשבון מקושר', React.createElement('select', { style: styles.input, value: form.account_id, onChange: e => set('account_id', e.target.value) },
            React.createElement('option', { value: '' }, '— בחר —'),
            accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
          )),
          Field('קטגוריה', React.createElement('select', { style: styles.input, value: form.category_id, onChange: e => set('category_id', e.target.value) },
            React.createElement('option', { value: '' }, '— בחר —'),
            categories.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.name} ${c.icon || ''}`))
          )),
        ),

        type === 'recurring' && React.createElement(React.Fragment, null,
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 } },
            Field('סכום (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.amount, onChange: e => set('amount', e.target.value) })),
            Field('תדירות', React.createElement('select', { style: styles.input, value: form.frequency, onChange: e => set('frequency', e.target.value) },
              React.createElement('option', { value: 'monthly' }, 'חודשי'),
              React.createElement('option', { value: 'quarterly' }, 'רבעוני'),
              React.createElement('option', { value: 'annual' }, 'שנתי'),
            )),
            Field('יום בחודש', React.createElement('input', { style: styles.input, type: 'number', min: 1, max: 28, value: form.charge_day, onChange: e => set('charge_day', e.target.value) })),
          ),
          React.createElement('label', { style: styles.checkLabel },
            React.createElement('input', { type: 'checkbox', checked: !!form.is_estimated, onChange: e => set('is_estimated', e.target.checked) }),
            ' סכום משתנה / משוער (~)'
          ),
        ),

        type === 'installment' && React.createElement(React.Fragment, null,
          React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
            Field('סך כל העסקה (₪)', React.createElement('input', { style: styles.input, type: 'number', value: form.total_amount, onChange: e => set('total_amount', e.target.value), placeholder: '12000' })),
            Field('מספר תשלומים', React.createElement('input', { style: styles.input, type: 'number', value: form.num_installments, onChange: e => set('num_installments', e.target.value), placeholder: '12' })),
          ),
          installmentAmount && React.createElement('div', { style: { backgroundColor: '#EFF6FF', borderRadius: 10, padding: 10, marginBottom: 12 } },
            React.createElement('p', { style: { fontSize: 13, color: '#2563EB', fontWeight: '500' } },
              `תשלום חודשי: ₪${installmentAmount.toLocaleString('he-IL')}`
            ),
          ),
          Field('תאריך תשלום ראשון', React.createElement('input', { style: styles.input, type: 'date', value: form.first_charge_date, onChange: e => set('first_charge_date', e.target.value) })),
        ),

        React.createElement('div', { style: { borderTop: '1px solid #E2E8F0', paddingTop: 12, marginTop: 4 } },
          React.createElement('p', { style: { fontSize: 12, fontWeight: '600', color: '#94A3B8', marginBottom: 8, textTransform: 'uppercase' } }, 'הגדרות נוספות'),
          React.createElement('div', { style: { display: 'flex', gap: 16, marginBottom: 12 } },
            React.createElement('label', { style: styles.checkLabel },
              React.createElement('input', { type: 'checkbox', checked: !!form.is_budgetary, onChange: e => set('is_budgetary', e.target.checked) }),
              ' תקציבי'
            ),
            React.createElement('label', { style: styles.checkLabel },
              React.createElement('input', { type: 'checkbox', checked: !!form.is_maaser_obligated, onChange: e => set('is_maaser_obligated', e.target.checked) }),
              ' חייב במעשר'
            ),
          ),
          Field('הערות', React.createElement('input', { style: styles.input, value: form.notes, onChange: e => set('notes', e.target.value), placeholder: 'הערות נוספות...' })),
        ),

        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12 } }, error),
      ),

      // 3 כפתורים בתחתית
      React.createElement('div', { style: { ...styles.modalFooter, justifyContent: 'space-between' } },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', { style: styles.btnSecondary, onClick: () => saveTemplate(false) }, 'שמור ללא תבנית'),
          React.createElement('button', { style: styles.btnPrimary, onClick: () => saveTemplate(true) }, 'שמור עם תנועות וירטואליות'),
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
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 },
  kpiCard: { backgroundColor: '#fff', borderRadius: 14, border: '1px solid #E2E8F0', padding: 16 },
  kpiLabel: { fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 },
  kpiValue: { fontSize: 22, fontWeight: 'bold' },
  segmented: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 12, overflow: 'hidden', marginBottom: 16, backgroundColor: '#F8FAFC' },
  segBtn: { flex: 1, padding: '10px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: 'transparent', color: '#475569', fontWeight: '500' },
  segBtnActive: { backgroundColor: '#2563EB', color: '#fff' },
  card: { backgroundColor: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: 14 },
  cardInner: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  cardName: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 3 },
  cardSub: { fontSize: 11, color: '#64748B', marginBottom: 1 },
  badge: { fontSize: 10, backgroundColor: '#F1F5F9', color: '#475569', padding: '2px 6px', borderRadius: 4 },
  actionBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: '2px 5px', borderRadius: 6, color: '#475569' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 60, color: '#94A3B8', textAlign: 'center' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
  checkLabel: { fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 },
}

function LinkTransactionsModal({ template, fmt, onClose, onSave }) {
  const [selected, setSelected] = useState([])

  const candidates = db.prepare(`
    SELECT t.*, a.name as account_name FROM Transactions t
    LEFT JOIN Accounts a ON t.account_id=a.id
    WHERE t.recurring_id IS NULL
      AND t.transaction_type='Expense'
      AND (
        t.business_entity LIKE ? OR
        ABS(t.amount - ?) < ? * 0.2
      )
      AND t.transaction_date >= date('now', '-365 days')
    ORDER BY t.transaction_date DESC
    LIMIT 30
  `).all(`%${template.name}%`, template.amount, template.amount)

  function toggleSelect(id) {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  function handleLink() {
    const stmt = db.prepare('UPDATE Transactions SET recurring_id=? WHERE id=?')
    const linkAll = db.transaction(() => {
      for (const id of selected) stmt.run(template.id, id)
    })
    linkAll()

    // בדוק אם יש תנועה מקושרת עם סכום גבוה יותר מהמשוער
    if (template.is_estimated) {
      const linkedAmounts = candidates.filter(c => selected.includes(c.id))
      const maxAmount = Math.max(...linkedAmounts.map(t => t.amount))
      if (maxAmount > template.amount) {
        if (confirm(`התנועה האחרונה המקושרת היא ₪${maxAmount.toLocaleString('he-IL')} — גבוהה מהסכום הרשום (₪${template.amount.toLocaleString('he-IL')}). האם לעדכן את הסכום?`)) {
          db.prepare('UPDATE Recurring_Templates SET amount=? WHERE id=?').run(maxAmount, template.id)
        }
      }
    }

    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 520 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, `🔗 שייך רשומות — ${template.name}`),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: { padding: '10px 24px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0' } },
        React.createElement('p', { style: { fontSize: 12, color: '#64748B' } },
          `תנועות תואמות לפי שם ו/או סכום (±20%) — ${candidates.length} נמצאו`
        ),
      ),
      React.createElement('div', { style: { ...styles.modalBody, maxHeight: 400, overflowY: 'auto' } },
        candidates.length === 0
          ? React.createElement('p', { style: { color: '#94A3B8', textAlign: 'center', padding: 20 } }, 'לא נמצאו תנועות תואמות')
          : candidates.map(tx =>
              React.createElement('div', {
                key: tx.id,
                style: {
                  display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                  borderRadius: 10, marginBottom: 6, cursor: 'pointer',
                  backgroundColor: selected.includes(tx.id) ? '#EFF6FF' : '#F8FAFC',
                  border: selected.includes(tx.id) ? '1px solid #2563EB' : '1px solid #E2E8F0',
                },
                onClick: () => toggleSelect(tx.id),
              },
                React.createElement('input', {
                  type: 'checkbox',
                  checked: selected.includes(tx.id),
                  onChange: () => toggleSelect(tx.id),
                }),
                React.createElement('div', { style: { flex: 1 } },
                  React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A' } }, tx.business_entity || '—'),
                  React.createElement('p', { style: { fontSize: 11, color: '#64748B' } }, `${tx.transaction_date} | ${tx.account_name || '—'}`),
                ),
                React.createElement('span', { style: { fontSize: 13, fontWeight: '600', color: '#E11D48' } },
                  `−${fmt(tx.amount)}`
                ),
              )
            )
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', {
          style: { ...styles.btnPrimary, opacity: selected.length === 0 ? 0.5 : 1 },
          disabled: selected.length === 0,
          onClick: handleLink,
        }, `שייך ${selected.length > 0 ? `(${selected.length})` : ''}`),
      ),
    )
  )
}

module.exports = Recurring