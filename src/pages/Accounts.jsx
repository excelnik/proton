const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')

function Accounts() {
  const [accounts, setAccounts] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editAccount, setEditAccount] = useState(null)

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

  function loadAccounts() {
    const accs = db.prepare('SELECT * FROM Accounts WHERE is_active=1').all()
    const result = accs.map(acc => {
      const stats = db.prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN transaction_type='Income'  THEN amount ELSE 0 END), 0) as inc,
          COALESCE(SUM(CASE WHEN transaction_type='Expense' THEN amount ELSE 0 END), 0) as exp
        FROM Transactions WHERE account_id=?
      `).get(acc.id)
      return { ...acc, balance: acc.opening_balance + stats.inc - stats.exp }
    })
    setAccounts(result)
  }

  useEffect(() => { loadAccounts() }, [])

  const fmt = n => '₪' + n.toLocaleString('he-IL')
  const TYPE_ICONS  = { Bank: '🏦', Credit_Card: '💳', Cash: '💵' }
  const TYPE_LABELS = { Bank: 'עו״ש', Credit_Card: 'אשראי', Cash: 'מזומן' }

  return React.createElement('div', { style: styles.page },
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'ניהול חשבונות'),
      React.createElement('button', {
        style: styles.btnPrimary,
        onClick: () => { setEditAccount(null); setShowModal(true) },
      }, '+ הוסף חשבון'),
    ),

    accounts.length === 0
      ? React.createElement('div', { style: styles.empty },
          React.createElement('p', { style: { fontSize: 40 } }, '🏦'),
          React.createElement('p', { style: styles.emptyTitle }, 'אין חשבונות עדיין'),
          React.createElement('button', {
            style: styles.btnPrimary,
            onClick: () => { setEditAccount(null); setShowModal(true) },
          }, 'הוסף חשבון ראשון'),
        )
      : React.createElement('div', { style: styles.grid3 },
          accounts.map(acc =>
            React.createElement('div', { key: acc.id, style: styles.card },
              React.createElement('div', { style: styles.cardTop },
                React.createElement('span', { style: { fontSize: 24 } }, TYPE_ICONS[acc.type] || '🏦'),
                React.createElement('span', { style: styles.badge }, TYPE_LABELS[acc.type]),
              ),
              React.createElement('p', { style: styles.cardName }, acc.name),
              React.createElement('p', { style: styles.cardBalance }, fmt(acc.balance)),
              React.createElement('p', { style: styles.cardSub }, `יתרת פתיחה: ${fmt(acc.opening_balance)}`),
              React.createElement('button', {
                style: { ...styles.btnSecondary, width: '100%', marginTop: 12, fontSize: 12 },
                onClick: () => { setEditAccount(acc); setShowModal(true) },
              }, '✏️ ערוך חשבון'),
            )
          )
        ),

    showModal && React.createElement(AccountModal, {
      editAccount,
      onClose: () => { setShowModal(false); setEditAccount(null) },
      onSave:  () => { setShowModal(false); setEditAccount(null); loadAccounts() },
    }),
  )
}

function AccountModal({ editAccount, onClose, onSave }) {
  const [name, setName]                   = useState(editAccount?.name ?? '')
  const [type, setType]                   = useState(editAccount?.type ?? 'Bank')
  const [openingBalance, setOpeningBalance] = useState(editAccount?.opening_balance?.toString() ?? '')
  const [error, setError]                 = useState('')

  function handleSave() {
    if (!name.trim()) { setError('נא להזין שם לחשבון'); return }
    if (editAccount) {
      db.prepare('UPDATE Accounts SET name=?, type=?, opening_balance=? WHERE id=?')
        .run(name.trim(), type, parseFloat(openingBalance) || 0, editAccount.id)
    } else {
      db.prepare('INSERT INTO Accounts (name, type, opening_balance) VALUES (?, ?, ?)')
        .run(name.trim(), type, parseFloat(openingBalance) || 0)
    }
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: styles.modal },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle },
          editAccount ? 'עריכת חשבון' : 'הוספת חשבון חדש'
        ),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        Field('שם החשבון', React.createElement('input', {
          style: styles.input,
          placeholder: 'עו״ש פועלים',
          value: name,
          onChange: e => setName(e.target.value),
        })),
        Field('סוג חשבון', React.createElement('select', {
          style: styles.input,
          value: type,
          onChange: e => setType(e.target.value),
        },
          React.createElement('option', { value: 'Bank' }, 'עו״ש'),
          React.createElement('option', { value: 'Credit_Card' }, 'כרטיס אשראי'),
          React.createElement('option', { value: 'Cash' }, 'מזומן'),
        )),
        Field('יתרת פתיחה (₪)', React.createElement('input', {
          style: styles.input,
          type: 'number',
          placeholder: '0',
          value: openingBalance,
          onChange: e => setOpeningBalance(e.target.value),
        })),
        error && React.createElement('p', { style: { color: '#E11D48', fontSize: 12, marginTop: 4 } }, error),
      ),
      React.createElement('div', { style: styles.modalFooter },
        React.createElement('button', { style: styles.btnSecondary, onClick: onClose }, 'ביטול'),
        React.createElement('button', { style: styles.btnPrimary, onClick: handleSave }, 'שמור'),
      ),
    )
  )
}

function Field(label, input) {
  return React.createElement('div', { style: { marginBottom: 16 } },
    React.createElement('label', { style: { fontSize: 13, fontWeight: '500', color: '#475569', display: 'block', marginBottom: 4 } }, label),
    input,
  )
}

const styles = {
  page: { padding: 32 },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A' },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 16px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
  btnSecondary: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 16px', fontSize: 13, cursor: 'pointer' },
  grid3: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: 20 },
  cardTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  badge: { fontSize: 11, backgroundColor: '#F1F5F9', color: '#475569', padding: '2px 8px', borderRadius: 6 },
  cardName: { fontWeight: 'bold', fontSize: 15, color: '#0F172A', marginBottom: 6 },
  cardBalance: { fontSize: 22, fontWeight: 'bold', color: '#2563EB', marginBottom: 4 },
  cardSub: { fontSize: 11, color: '#94A3B8' },
  empty: { textAlign: 'center', padding: '60px 0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#475569' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none' },
}

module.exports = Accounts