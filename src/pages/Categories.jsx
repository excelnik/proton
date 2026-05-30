const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')

function Categories() {
  const [categories, setCategories] = useState([])
  const [showModal, setShowModal] = useState(false)
  const [editCat, setEditCat] = useState(null)
  const [parentCat, setParentCat] = useState(null)
  const [filterType, setFilterType] = useState('all')
  const [expandedCat, setExpandedCat] = useState(null)

  function loadCategories() {
    const cats = db.prepare(`
      SELECT c.*, 
        (SELECT COUNT(*) FROM Transactions WHERE category_id=c.id) as tx_count,
        (SELECT COUNT(*) FROM Categories WHERE parent_id=c.id) as sub_count
      FROM Categories c
      WHERE c.parent_id IS NULL
      ORDER BY c.sort_order, c.name
    `).all()

    const withSubs = cats.map(cat => {
      const subs = db.prepare(`
        SELECT c.*,
          (SELECT COUNT(*) FROM Transactions WHERE category_id=c.id) as tx_count
        FROM Categories c
        WHERE c.parent_id=?
        ORDER BY c.sort_order, c.name
      `).all(cat.id)
      return { ...cat, subcategories: subs }
    })

    setCategories(withSubs)
  }

  useEffect(() => { loadCategories() }, [])

  function handleToggleActive(cat) {
    db.prepare('UPDATE Categories SET is_active=? WHERE id=?').run(cat.is_active ? 0 : 1, cat.id)
    loadCategories()
  }

  function handleDelete(cat) {
    if (cat.tx_count > 0 || cat.sub_count > 0) {
      alert('לא ניתן למחוק קטגוריה עם תנועות או תת-קטגוריות. ניתן להפוך אותה ללא פעילה.')
      return
    }
    if (!confirm(`למחוק את "${cat.name}"?`)) return
    db.prepare('DELETE FROM Categories WHERE id=?').run(cat.id)
    loadCategories()
  }

  function moveUp(cat, list) {
    const idx = list.findIndex(c => c.id === cat.id)
    if (idx === 0) return
    const prev = list[idx - 1]
    db.prepare('UPDATE Categories SET sort_order=? WHERE id=?').run(prev.sort_order, cat.id)
    db.prepare('UPDATE Categories SET sort_order=? WHERE id=?').run(cat.sort_order, prev.id)
    loadCategories()
  }

  function moveDown(cat, list) {
    const idx = list.findIndex(c => c.id === cat.id)
    if (idx === list.length - 1) return
    const next = list[idx + 1]
    db.prepare('UPDATE Categories SET sort_order=? WHERE id=?').run(next.sort_order, cat.id)
    db.prepare('UPDATE Categories SET sort_order=? WHERE id=?').run(cat.sort_order, next.id)
    loadCategories()
  }

  function sortAlpha() {
    const toSort = filterType === 'all'
      ? categories
      : categories.filter(c => c.type === filterType)

    const sorted = [...toSort].sort((a, b) => a.name.localeCompare(b.name, 'he'))

    db.transaction(() => {
      sorted.forEach((cat, i) => {
        db.prepare('UPDATE Categories SET sort_order=? WHERE id=?').run(i + 1, cat.id)
      })
    })()
    loadCategories()
  }

  const filtered = categories.filter(c => filterType === 'all' || c.type === filterType)
  const TYPE_LABELS = { Income: 'הכנסה', Expense: 'הוצאה', Savings: 'חיסכון' }

  return React.createElement('div', { style: styles.page },

    // Header
    React.createElement('div', { style: styles.header },
      React.createElement('h1', { style: styles.title }, 'ניהול קטגוריות'),
      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', {
          style: styles.btnSecondary,
          onClick: () => sortAlpha(),
          title: 'מיין א-ת',
        }, 'מיין א-ת'),
        React.createElement('button', {
          style: styles.btnPrimary,
          onClick: () => { setEditCat(null); setParentCat(null); setShowModal(true) },
        }, '+ קטגוריה חדשה'),
      ),
    ),

    // סינון לפי סוג
    React.createElement('div', { style: styles.segmented },
      ['all', 'Income', 'Expense', 'Savings'].map(t =>
        React.createElement('button', {
          key: t,
          style: { ...styles.segBtn, ...(filterType === t ? styles.segBtnActive : {}) },
          onClick: () => setFilterType(t),
        }, t === 'all' ? 'הכל' : TYPE_LABELS[t])
      )
    ),

    // רשימת קטגוריות
    React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 8 } },
      filtered.map(cat =>
        React.createElement('div', { key: cat.id },

          // קטגוריה ראשית
          React.createElement('div', { style: { ...styles.catRow, opacity: cat.is_active ? 1 : 0.5 } },
            React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 10, flex: 1 } },
              React.createElement('span', { style: { fontSize: 20 } }, cat.icon || '📁'),
              React.createElement('div', null,
                React.createElement('p', { style: styles.catName },
                  cat.name,
                  !cat.is_active && React.createElement('span', { style: styles.inactiveBadge }, ' לא פעיל'),
                ),
                React.createElement('p', { style: styles.catMeta },
                  `${TYPE_LABELS[cat.type] || cat.type} | ${cat.tx_count} תנועות | ${cat.sub_count} תת-קטגוריות`
                ),
              ),
              cat.color && React.createElement('div', { style: { width: 12, height: 12, borderRadius: '50%', backgroundColor: cat.color, marginRight: 4 } }),
            ),
            React.createElement('div', { style: { display: 'flex', gap: 4, alignItems: 'center' } },
              React.createElement('button', { style: styles.iconBtn, onClick: () => moveUp(cat, filtered), title: 'הזז למעלה' }, '↑'),
              React.createElement('button', { style: styles.iconBtn, onClick: () => moveDown(cat, filtered), title: 'הזז למטה' }, '↓'),
              React.createElement('button', { style: styles.iconBtn, onClick: () => { setParentCat(cat); setEditCat(null); setShowModal(true) }, title: 'הוסף תת-קטגוריה' }, '+'),
              React.createElement('button', { style: styles.iconBtn, onClick: () => { setEditCat(cat); setParentCat(null); setShowModal(true) } }, '✏️'),
              React.createElement('button', {
                style: { ...styles.iconBtn, color: cat.is_active ? '#F59E0B' : '#10B981' },
                onClick: () => handleToggleActive(cat),
                title: cat.is_active ? 'השבת' : 'הפעל',
              }, cat.is_active ? '⏸' : '▶️'),
              React.createElement('button', {
                style: { ...styles.iconBtn, color: '#E11D48', opacity: cat.tx_count > 0 || cat.sub_count > 0 ? 0.3 : 1 },
                onClick: () => handleDelete(cat),
              }, '🗑'),
            ),
          ),

          // תת-קטגוריות
          cat.subcategories.length > 0 && React.createElement('div', null,
            React.createElement('div', {
              style: { paddingRight: 32, paddingTop: 4, paddingBottom: 2, cursor: 'pointer', fontSize: 11, color: '#94A3B8', display: 'flex', alignItems: 'center', gap: 4 },
              onClick: () => setExpandedCat(expandedCat === cat.id ? null : cat.id),
            },
              React.createElement('span', null, expandedCat === cat.id ? '▲' : '▼'),
              React.createElement('span', null, `${cat.subcategories.length} תת-קטגוריות`),
            ),
            expandedCat === cat.id && React.createElement('div', { style: { marginRight: 32, marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 } },            cat.subcategories.map(sub =>
              React.createElement('div', { key: sub.id, style: { ...styles.subCatRow, opacity: sub.is_active ? 1 : 0.5 } },
                React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8, flex: 1 } },
                  React.createElement('span', { style: { color: '#94A3B8' } }, '└'),
                  React.createElement('span', { style: { fontSize: 16 } }, sub.icon || '📄'),
                  React.createElement('div', null,
                    React.createElement('p', { style: { ...styles.catName, fontSize: 13 } },
                      sub.name,
                      !sub.is_active && React.createElement('span', { style: styles.inactiveBadge }, ' לא פעיל'),
                    ),
                    React.createElement('p', { style: styles.catMeta }, `${sub.tx_count} תנועות`),
                  ),
                ),
                React.createElement('div', { style: { display: 'flex', gap: 4 } },
                  React.createElement('button', { style: styles.iconBtn, onClick: () => moveUp(sub, cat.subcategories) }, '↑'),
                  React.createElement('button', { style: styles.iconBtn, onClick: () => moveDown(sub, cat.subcategories) }, '↓'),
                  React.createElement('button', { style: styles.iconBtn, onClick: () => { setEditCat(sub); setParentCat(cat); setShowModal(true) } }, '✏️'),
                  React.createElement('button', {
                    style: { ...styles.iconBtn, color: sub.is_active ? '#F59E0B' : '#10B981' },
                    onClick: () => handleToggleActive(sub),
                  }, sub.is_active ? '⏸' : '▶️'),
                  React.createElement('button', {
                    style: { ...styles.iconBtn, color: '#E11D48', opacity: sub.tx_count > 0 ? 0.3 : 1 },
                    onClick: () => handleDelete(sub),
                  }, '🗑'),
                ),
              )
            )
          ),
        )
      )
    )
  ),
    showModal && React.createElement(CategoryModal, {
      editCat,
      parentCat,
      onClose: () => { setShowModal(false); setEditCat(null); setParentCat(null) },
      onSave: () => { setShowModal(false); setEditCat(null); setParentCat(null); loadCategories() },
    }),
  )
}

// ─── מודאל הוספה/עריכה ────────────────────────────────────────────────────

function CategoryModal({ editCat, parentCat, onClose, onSave }) {
  const isSubCat = !!parentCat && !editCat?.parent_id === false || !!parentCat

  const [form, setForm] = useState({
    name: editCat?.name ?? '',
    type: editCat?.type ?? (parentCat?.type ?? 'Expense'),
    icon: editCat?.icon ?? '',
    color: editCat?.color ?? '#64748B',
    parent_id: editCat?.parent_id ?? parentCat?.id ?? null,
  })
  const [error, setError] = useState('')
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // קטגוריות אב אפשריות (רק ראשיות)
  const parentOptions = db.prepare('SELECT * FROM Categories WHERE parent_id IS NULL AND is_active=1 ORDER BY sort_order').all()

  const ICONS = ['🛒', '🚗', '🏠', '💊', '🛡️', '📚', '🎭', '👕', '🕍', '🏦', '💰', '⚙️', '💼', '💵', '↩️', '🎁', '🏛️', '📈', '🎯', '🔄', '📋', '🍽️', '✈️', '🎮', '🐾', '👶', '🏋️', '📱', '🔧', '🎵']

  function handleSave() {
    if (!form.name.trim()) { setError('נא להזין שם'); return }

    const maxOrder = db.prepare('SELECT MAX(sort_order) as m FROM Categories').get().m || 0

    if (editCat) {
      db.prepare('UPDATE Categories SET name=?, type=?, icon=?, color=?, parent_id=? WHERE id=?')
        .run(form.name.trim(), form.type, form.icon || null, form.color, form.parent_id || null, editCat.id)
    } else {
      db.prepare('INSERT INTO Categories (name, type, icon, color, parent_id, is_active, is_system_category, sort_order) VALUES (?, ?, ?, ?, ?, 1, 0, ?)')
        .run(form.name.trim(), form.type, form.icon || null, form.color, form.parent_id || null, maxOrder + 1)
    }
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 480 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle },
          editCat ? 'עריכת קטגוריה' : parentCat ? `תת-קטגוריה של "${parentCat.name}"` : 'קטגוריה חדשה'
        ),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },

        Field('שם', React.createElement('input', { style: styles.input, value: form.name, onChange: e => set('name', e.target.value), placeholder: 'שם הקטגוריה' })),

        !parentCat && React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
          Field('סוג', React.createElement('select', { style: styles.input, value: form.type, onChange: e => set('type', e.target.value) },
            React.createElement('option', { value: 'Expense' }, 'הוצאה'),
            React.createElement('option', { value: 'Income' }, 'הכנסה'),
            React.createElement('option', { value: 'Savings' }, 'חיסכון'),
          )),
          Field('קטגוריית אב (אופציונלי)', React.createElement('select', { style: styles.input, value: form.parent_id || '', onChange: e => set('parent_id', e.target.value || null) },
            React.createElement('option', { value: '' }, '— ראשית —'),
            parentOptions.map(p => React.createElement('option', { key: p.id, value: p.id }, p.name))
          )),
        ),

        Field('אייקון', React.createElement('div', null,
          React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
            ICONS.map(icon =>
              React.createElement('button', {
                key: icon,
                style: {
                  fontSize: 18, padding: '4px 6px', borderRadius: 6, border: '1px solid',
                  borderColor: form.icon === icon ? '#2563EB' : '#E2E8F0',
                  backgroundColor: form.icon === icon ? '#EFF6FF' : '#fff',
                  cursor: 'pointer',
                },
                onClick: () => set('icon', icon),
              }, icon)
            )
          ),
          React.createElement('input', { style: { ...styles.input, width: 80 }, value: form.icon, onChange: e => set('icon', e.target.value), placeholder: 'או הקלד' }),
        )),

        Field('צבע', React.createElement('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          React.createElement('input', { type: 'color', value: form.color, onChange: e => set('color', e.target.value), style: { width: 40, height: 36, borderRadius: 8, border: '1px solid #E2E8F0', cursor: 'pointer' } }),
          React.createElement('span', { style: { fontSize: 12, color: '#64748B' } }, form.color),
        )),

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
  segmented: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden', marginBottom: 16, backgroundColor: '#F8FAFC' },
  segBtn: { flex: 1, padding: '8px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: 'transparent', color: '#475569' },
  segBtnActive: { backgroundColor: '#2563EB', color: '#fff' },
  catRow: { backgroundColor: '#fff', borderRadius: 12, border: '1px solid #E2E8F0', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 },
  subCatRow: { backgroundColor: '#F8FAFC', borderRadius: 10, border: '1px solid #F1F5F9', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 },
  catName: { fontSize: 14, fontWeight: '600', color: '#0F172A', marginBottom: 2 },
  catMeta: { fontSize: 11, color: '#94A3B8' },
  inactiveBadge: { fontSize: 10, backgroundColor: '#F1F5F9', color: '#94A3B8', padding: '1px 6px', borderRadius: 4, marginRight: 4 },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '3px 6px', borderRadius: 6, color: '#475569' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)', maxHeight: '90vh', overflowY: 'auto' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
}

module.exports = Categories