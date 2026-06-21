const React = require('react')
const { useState, useEffect } = React
const db = require('../db/index.js')
const XLSX = require('xlsx')

const HEADER_KEYWORDS = [
  'תאריך', 'סכום', 'תיאור', 'זכות', 'חובה', 'פעולה',
  'בית עסק', 'תאריך ביצוע', 'סכום עסקה', 'שם בית עסק',
  'date', 'amount', 'description', 'credit', 'debit'
]

function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const matches = rows[i].filter(cell =>
      HEADER_KEYWORDS.some(kw =>
        String(cell ?? '').trim().toLowerCase().includes(kw.toLowerCase())
      )
    )
    if (matches.length >= 2) return i
  }
  return 0
}

function parseDate(dateStr) {
  if (!dateStr) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr
  const parts = dateStr.split('/')
  if (parts.length === 3) {
    let [a, b, c] = parts
    if (c.length === 2) c = '20' + c
    if (parseInt(a) <= 31 && parseInt(b) <= 12) {
      return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`
    }
  }
  const parts2 = dateStr.split('-')
  if (parts2.length === 3 && parts2[0].length === 2) {
    return `${parts2[2]}-${parts2[1]}-${parts2[0]}`
  }
  const d = new Date(dateStr)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return ''
}

function getDefaultDay() {
  try {
    const row = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string='default_transaction_day' AND match_type='setting'"
    ).get()
    return row ? parseInt(row.cleaned_name) : 25
  } catch { return 25 }
}

function getDefaultFallbackMonth() {
  const d = new Date()
  d.setMonth(d.getMonth() - 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function loadSavedMapping(accountId) {
  try {
    const saved = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string=? AND match_type='mapping'"
    ).get(`mapping_${accountId}`)
    if (saved) return JSON.parse(saved.cleaned_name)
  } catch {}
  return null
}

function saveMapping(accountId, mapping) {
  try {
    const key = `mapping_${accountId}`
    const val = JSON.stringify(mapping)
    const exists = db.prepare(
      "SELECT id FROM Automation_Rules WHERE original_string=? AND match_type='mapping'"
    ).get(key)
    if (exists) {
      db.prepare("UPDATE Automation_Rules SET cleaned_name=? WHERE original_string=? AND match_type='mapping'").run(val, key)
    } else {
      db.prepare("INSERT INTO Automation_Rules (original_string, cleaned_name, match_type, priority, use_count) VALUES (?,?,'mapping',0,0)").run(key, val)
    }
  } catch {}
}

function findBestRule(businessEntity) {
  if (!businessEntity) return null
  const name = businessEntity.toLowerCase().trim()
  const rules = db.prepare(`
    SELECT r.*, c.name as category_name FROM Automation_Rules r
    LEFT JOIN Categories c ON r.category_id=c.id
    WHERE r.match_type NOT IN ('mapping','setting')
    AND r.category_id IS NOT NULL
  `).all()
  if (rules.length === 0) return null

  // שלב 1 — התאמה מדויקת
  const exactMatches = rules.filter(r => r.original_string.toLowerCase() === name)
  if (exactMatches.length === 1) return exactMatches[0]
  if (exactMatches.length > 1) return exactMatches.sort((a, b) => b.use_count - a.use_count)[0]

  // שלב 2 — התאמה חלקית לפי מילים
  const stopWords = ['בעמ', 'בע"מ', 'חברה', 'עוסק', 'מורשה', 'בע', 'של', 'את', 'על', 'עם', 'ltd', 'inc']
  const getWords = str => str.toLowerCase()
    .replace(/[^א-תa-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.includes(w))

  const currentWords = getWords(name)
  if (currentWords.length === 0) return null

  let scores = {}
  let ruleMap = {}
  for (const rule of rules) {
    const ruleWords = getWords(rule.original_string)
    const matches = currentWords.filter(cw => 
      ruleWords.some(rw => 
        rw.includes(cw) || 
        cw.includes(rw) ||
        (cw.length >= 4 && rw.length >= 4 && (rw.startsWith(cw.slice(0, 4)) || cw.startsWith(rw.slice(0, 4))))
      )
    )
    if (matches.length > 0) {
      const key = rule.category_id
      // צבור ניקוד מכל החוקים לאותה קטגוריה
      scores[key] = (scores[key] || 0) + matches.length * (rule.use_count || 1)
      // שמור את החוק עם הניקוד הגבוה ביותר לייצוג
      if (!ruleMap[key] || matches.length * (rule.use_count || 1) > (ruleMap[key]._score || 0)) {
        ruleMap[key] = { ...rule, _score: matches.length * (rule.use_count || 1) }
      }
    }
  }

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1])
  if (sorted.length > 0) return ruleMap[parseInt(sorted[0][0])]
  return null
}

function Import({ onNavigate }) {
  const [step, setStep] = useState(0)
  const [accounts, setAccounts] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedAccount, setSelectedAccount] = useState('')
  const [inputMode, setInputMode] = useState('file')
  const [pasteText, setPasteText] = useState('')
  const [hasHeaders, setHasHeaders] = useState(true)
  const [headers, setHeaders] = useState([])
  const [allRows, setAllRows] = useState([])
  const [fallbackMonth, setFallbackMonth] = useState(getDefaultFallbackMonth)
  const [mapping, setMapping] = useState({
    date_col: '', value_date_col: '', business_col: '',
    details_col: '', account_col: '',
    amount_mode: 'single', amount_col: '',
    debit_col: '', credit_col: '',
    amount_type: 'minus_expense',
  })
  const [reviewRows, setReviewRows] = useState([])
  const [fileName, setFileName] = useState('')
  const [step3Result, setStep3Result] = useState(null)
  const [activeTab, setActiveTab] = useState('new')
  const [importHistory, setImportHistory] = useState([])

  useEffect(() => {
    setAccounts(db.prepare('SELECT * FROM Accounts WHERE is_active=1').all())
    setCategories(db.prepare('SELECT * FROM Categories WHERE is_active=1 ORDER BY sort_order').all())
  }, [])

  useEffect(() => {
    if (!selectedAccount) return
    const saved = loadSavedMapping(selectedAccount)
    if (saved) setMapping(m => ({ ...m, ...saved }))
  }, [selectedAccount])

  function loadImportHistory() {
      try {
        const rows = db.prepare(`
          SELECT import_id,
                COUNT(*) as count,
                MIN(transaction_date) as date_from,
                MAX(transaction_date) as date_to,
                MIN(created_at) as imported_at,
                GROUP_CONCAT(DISTINCT account_name) as accounts
          FROM (
            SELECT t.import_id, t.transaction_date, t.created_at, a.name as account_name
            FROM Transactions t
            LEFT JOIN Accounts a ON t.account_id = a.id
            WHERE t.import_id IS NOT NULL
          )
          GROUP BY import_id
          ORDER BY imported_at DESC
        `).all()
        setImportHistory(rows)
      } catch { setImportHistory([]) }
    }

    useEffect(() => { loadImportHistory() }, [])

  function processRows(rows, forceHasHeaders) {
    const useHeaders = forceHasHeaders !== undefined ? forceHasHeaders : hasHeaders
    let hdrs, dataRows

    if (useHeaders) {
      const headerIdx = findHeaderRow(rows)
      hdrs = rows[headerIdx].map(h => String(h ?? '').trim())
      dataRows = rows.slice(headerIdx + 1).filter(row =>
        row.some(cell => String(cell ?? '').trim() !== '')
      )
    } else {
      hdrs = rows[0].map((_, i) => `עמודה ${i + 1}`)
      dataRows = rows.filter(row => row.some(cell => String(cell ?? '').trim() !== ''))
    }

    setHeaders(hdrs)
    setAllRows(dataRows)
    setStep(1)
  }

  function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = (evt) => {
      const workbook = XLSX.read(evt.target.result, { type: 'array', cellDates: true })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rawRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })
      processRows(rawRows)
    }
    reader.readAsArrayBuffer(file)
  }

  function handlePaste() {
    if (!pasteText.trim()) return
    const cleaned = pasteText
      .replace(/\u200F|\u200E|\u200B/g, '')
      .replace(/\u00A0/g, ' ')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
    const rows = cleaned.split('\n').map(r => r.split('\t'))
    processRows(rows)
  }

  function handleBuildReview() {
    if (selectedAccount) saveMapping(selectedAccount, mapping)

    const defaultDay = getDefaultDay()
    const fallbackDate = `${fallbackMonth}-${String(defaultDay).padStart(2, '0')}`

    const checkDup = db.prepare(`
      SELECT id FROM Transactions
      WHERE account_id=? AND amount=? AND business_entity=?
      AND ABS(julianday(transaction_date) - julianday(?)) <= 1
    `)

    const noDateCount = { count: 0 }

    const rows = allRows.map(row => {
      const rawDateStr = mapping.date_col !== '' ? String(row[mapping.date_col] ?? '').trim() : ''
      let rawDate = parseDate(rawDateStr)

      // תאריך חסר — השתמש בברירת מחדל
      if (!rawDate) {
        rawDate = fallbackDate
        noDateCount.count++
      }

      const rawBusiness = String(row[mapping.business_col] ?? '').trim()
      const valueDate = mapping.value_date_col !== ''
        ? (parseDate(String(row[mapping.value_date_col] ?? '').trim()) || rawDate)
        : rawDate
      const details = mapping.details_col !== ''
        ? String(row[mapping.details_col] ?? '').trim() : ''
      const accountName = mapping.account_col !== ''
        ? String(row[mapping.account_col] ?? '').trim() : ''

      let amount = 0
      let txType = 'Expense'

      if (mapping.amount_mode === 'double') {
        const debit  = parseFloat(String(row[mapping.debit_col]  ?? '').replace(/[,₪\s]/g, ''))
        const credit = parseFloat(String(row[mapping.credit_col] ?? '').replace(/[,₪\s]/g, ''))
        if (!isNaN(credit) && credit > 0) { amount = credit; txType = 'Income' }
        else if (!isNaN(debit) && debit > 0) { amount = debit; txType = 'Expense' }
      } else {
        const raw = parseFloat(String(row[mapping.amount_col] ?? '').replace(/[,₪\s]/g, ''))
        if (!isNaN(raw)) {
          amount = Math.abs(raw)
          txType = mapping.amount_type === 'minus_expense'
            ? (raw < 0 ? 'Expense' : 'Income')
            : (raw > 0 ? 'Expense' : 'Income')
        }
      }

      let accountId = selectedAccount || null
      if (!accountId && accountName) {
        const acc = accounts.find(a =>
          a.name.toLowerCase().includes(accountName.toLowerCase()) ||
          accountName.toLowerCase().includes(a.name.toLowerCase())
        )
        if (acc) accountId = acc.id
      }

      let isDuplicate = false
      if (accountId && amount && rawDate) {
        isDuplicate = !!checkDup.get(accountId, amount, rawBusiness, rawDate)
      }

      let categoryId = null
      let categoryName = null
      let autoDetected = false
      if (rawBusiness) {
        const rule = findBestRule(rawBusiness)
        if (rule) {
          categoryId = rule.category_id
          categoryName = rule.category_name ?? categories.find(c => c.id === rule.category_id)?.name ?? null
          autoDetected = true
        }
      }

      return {
        rawDate, rawBusiness, valueDate, details,
        amount, txType, accountId, accountName,
        isDuplicate, categoryId, categoryName, autoDetected,
        usedFallbackDate: !parseDate(rawDateStr),
      }
    }).filter(r => r.amount > 0)

    setReviewRows(rows)
    setStep(2)
  }

  function handleImport(includeAll) {
    const toImport = reviewRows.filter(r => includeAll || !r.isDuplicate)

    const importId = `import_${Date.now()}`

    const insertTx = db.prepare(`
      INSERT INTO Transactions
        (transaction_date, value_date, amount, transaction_type, business_entity,
         description, category_id, account_id, is_budgetary, is_maaser_obligated, source, import_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'import', ?)
    `)

    const importAll = db.transaction(() => {
      for (const row of toImport) {
        if (!row.accountId) continue
        insertTx.run(
          row.rawDate, row.valueDate || row.rawDate,
          row.amount, row.txType, row.rawBusiness,
          row.details || null, row.categoryId, row.accountId,
          importId
        )
            // שמור חוק אוטומטי
            if (row.rawBusiness && row.categoryId) {
              const existing = db.prepare(
                "SELECT id FROM Automation_Rules WHERE original_string=? AND match_type NOT IN ('mapping','setting')"
              ).get(row.rawBusiness.toLowerCase())
              if (!existing) {
                db.prepare(`
                  INSERT INTO Automation_Rules (original_string, cleaned_name, category_id, match_type, priority, use_count)
                  VALUES (?, ?, ?, 'contains', 0, 1)
                `).run(row.rawBusiness.toLowerCase(), row.rawBusiness, row.categoryId)
              } else {
                db.prepare('UPDATE Automation_Rules SET category_id=?, use_count=use_count+1 WHERE id=?')
                  .run(row.categoryId, existing.id)
              }
            }
      }
    })

    importAll()
    const imported = toImport.filter(r => r.accountId).length
    const skipped = reviewRows.length - imported
    setStep3Result({ imported, skipped, importId })
    setStep(3)
  }

  const setMap = (k, v) => setMapping(m => ({ ...m, [k]: v }))
  const needsAccountCol = !selectedAccount
  const newCount  = reviewRows.filter(r => !r.isDuplicate).length
  const dupCount  = reviewRows.filter(r => r.isDuplicate).length
  const autoCount = reviewRows.filter(r => r.autoDetected).length
  const fallbackCount = reviewRows.filter(r => r.usedFallbackDate).length

  const monthOptions = Array.from({ length: 24 }, (_, i) => {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' })
    return { val, label }
  })

  return React.createElement('div', { style: styles.page },
    React.createElement('h1', { style: styles.title }, 'יבוא תנועות מהבנק'),

    // טאבים
    React.createElement('div', { style: { display: 'flex', gap: 0, marginBottom: 20, borderBottom: '2px solid #E2E8F0' } },
      React.createElement('button', {
        style: { padding: '8px 20px', fontSize: 13, fontWeight: '500', border: 'none', cursor: 'pointer', borderBottom: activeTab === 'new' ? '2px solid #2563EB' : '2px solid transparent', color: activeTab === 'new' ? '#2563EB' : '#64748B', backgroundColor: 'transparent', marginBottom: -2 },
        onClick: () => setActiveTab('new'),
      }, '+ יבוא חדש'),
      React.createElement('button', {
        style: { padding: '8px 20px', fontSize: 13, fontWeight: '500', border: 'none', cursor: 'pointer', borderBottom: activeTab === 'history' ? '2px solid #2563EB' : '2px solid transparent', color: activeTab === 'history' ? '#2563EB' : '#64748B', backgroundColor: 'transparent', marginBottom: -2 },
        onClick: () => { setActiveTab('history'); loadImportHistory() },
      }, '📋 היסטוריית יבוא'),
    ),

    // היסטוריית ייבואים
    activeTab === 'history' && React.createElement('div', { style: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' } },
      importHistory.length === 0
        ? React.createElement('div', { style: { padding: 40, textAlign: 'center', color: '#94A3B8' } },
            React.createElement('p', { style: { fontSize: 32, marginBottom: 8 } }, '📭'),
            React.createElement('p', null, 'אין תהליכים קודמים'),
          )
        : React.createElement('table', { style: { ...styles.table, width: '100%' } },
            React.createElement('thead', null,
              React.createElement('tr', null,
                ['תאריך יבוא', 'תנועות', 'חשבון', 'טווח תאריכים', 'פעולה'].map(h =>
                  React.createElement('th', { key: h, style: styles.th }, h)
                )
              )
            ),
            React.createElement('tbody', null,
              importHistory.map(imp =>
                React.createElement('tr', { key: imp.import_id, style: { borderBottom: '1px solid #F1F5F9' } },
                  React.createElement('td', { style: styles.td },
                    new Date(imp.imported_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                  ),
                  React.createElement('td', { style: styles.td }, `${imp.count} תנועות`),
                  React.createElement('td', { style: styles.td }, imp.accounts || '—'),
                  React.createElement('td', { style: styles.td }, `${imp.date_from} — ${imp.date_to}`),
                  React.createElement('td', { style: styles.td },
                    React.createElement('button', {
                      style: { backgroundColor: '#FEF2F2', color: '#E11D48', border: '1px solid #FCA5A5', borderRadius: 8, padding: '4px 12px', fontSize: 12, cursor: 'pointer' },
                      onClick: () => {
                        if (!confirm(`למחוק ${imp.count} תנועות מיבוא זה?`)) return
                        db.prepare('DELETE FROM Transactions WHERE import_id=?').run(imp.import_id)
                        loadImportHistory()
                      },
                    }, '↩ בטל יבוא'),
                  ),
                )
              )
            )
          )
    ),

    // תוכן ייבוא חדש
    activeTab === 'new' && React.createElement('div', null,

    // Stepper
    React.createElement('div', { style: styles.stepper },
      ['בחירת מקור', 'מיפוי עמודות', 'סקירה ואישור', 'סיום'].map((s, i) =>
        React.createElement('div', { key: s, style: { display: 'flex', alignItems: 'center', gap: 6 } },
          React.createElement('div', {
            style: {
              ...styles.stepCircle,
              backgroundColor: i < step ? '#10B981' : i === step ? '#2563EB' : '#E2E8F0',
              color: i <= step ? '#fff' : '#94A3B8',
            }
          }, i < step ? '✓' : i + 1),
          React.createElement('span', { style: { fontSize: 12, color: i === step ? '#0F172A' : '#94A3B8', marginLeft: 4 } }, s),
          i < 3 && React.createElement('div', { style: styles.stepLine })
        )
      )
    ),

    // ── שלב 1 ──
    step === 0 && React.createElement('div', { style: styles.card },

      // חשבון
      React.createElement('div', { style: { marginBottom: 20 } },
        React.createElement('label', { style: styles.label }, 'חשבון יעד (אופציונלי)'),
        React.createElement('select', {
          style: styles.select,
          value: selectedAccount,
          onChange: e => setSelectedAccount(e.target.value),
        },
          React.createElement('option', { value: '' }, '— יבוא מרובה חשבונות —'),
          accounts.map(a => React.createElement('option', { key: a.id, value: a.id }, a.name))
        )
      ),

      // תאריך ברירת מחדל לשורות חסרות
      React.createElement('div', { style: { marginBottom: 20, backgroundColor: '#F8FAFC', borderRadius: 12, padding: 14, border: '1px solid #E2E8F0' } },
        React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A', marginBottom: 6 } },
          '📅 תאריך ברירת מחדל לשורות ללא תאריך'
        ),
        React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 8 } },
          'שורות שאין להן תאריך יקבלו תאריך זה אוטומטית'
        ),
        React.createElement('select', {
          style: { ...styles.select, width: 'auto' },
          value: fallbackMonth,
          onChange: e => setFallbackMonth(e.target.value),
        },
          monthOptions.map(m => React.createElement('option', { key: m.val, value: m.val }, m.label))
        ),
        React.createElement('span', { style: { fontSize: 12, color: '#64748B', marginRight: 8 } },
          ` יום ${getDefaultDay()}`
        ),
      ),

      // לשוניות
      React.createElement('div', { style: { display: 'flex', gap: 0, marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid #E2E8F0' } },
        React.createElement('button', {
          style: { ...styles.tabBtn, ...(inputMode === 'file' ? styles.tabBtnActive : {}) },
          onClick: () => setInputMode('file'),
        }, '📂 העלאת קובץ'),
        React.createElement('button', {
          style: { ...styles.tabBtn, ...(inputMode === 'paste' ? styles.tabBtnActive : {}) },
          onClick: () => setInputMode('paste'),
        }, '📋 הדבקת טקסט'),
      ),

      // קובץ
      inputMode === 'file' && React.createElement('div', null,
        React.createElement('div', {
          style: styles.dropZone,
          onClick: () => document.getElementById('file-input').click(),
        },
          fileName
            ? React.createElement('div', null,
                React.createElement('p', { style: { fontSize: 24 } }, '📄'),
                React.createElement('p', { style: { fontWeight: '500', marginTop: 4 } }, fileName),
              )
            : React.createElement('div', null,
                React.createElement('p', { style: { fontSize: 32, marginBottom: 8 } }, '📂'),
                React.createElement('p', { style: { color: '#475569', fontWeight: '500' } }, 'לחץ לבחירת קובץ'),
                React.createElement('p', { style: { color: '#94A3B8', fontSize: 12, marginTop: 4 } }, 'Excel (.xlsx) או CSV'),
              )
        ),
        React.createElement('input', {
          id: 'file-input', type: 'file', accept: '.xlsx,.xls,.csv',
          style: { display: 'none' }, onChange: handleFile,
        }),
      ),

      // הדבקה
      inputMode === 'paste' && React.createElement('div', null,
        React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 4 } },
          'העתק שורות מאקסל (Ctrl+C) והדבק כאן (Ctrl+V):'
        ),
        // checkbox כותרות
        React.createElement('label', { style: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#475569', marginBottom: 8, cursor: 'pointer' } },
          React.createElement('input', {
            type: 'checkbox',
            checked: hasHeaders,
            onChange: e => setHasHeaders(e.target.checked),
          }),
          'השורה הראשונה היא כותרת עמודות'
        ),
        React.createElement('textarea', {
          style: styles.textarea,
          placeholder: 'הדבק כאן את הנתונים מאקסל...',
          value: pasteText,
          onChange: e => setPasteText(e.target.value),
          rows: 8,
        }),
        React.createElement('button', {
          style: { ...styles.btnPrimary, marginTop: 8, opacity: !pasteText.trim() ? 0.5 : 1 },
          onClick: handlePaste,
          disabled: !pasteText.trim(),
        }, 'עבד נתונים'),
      ),
    ),

    // ── שלב 2 ──
    step === 1 && React.createElement('div', { style: styles.card },
      React.createElement('p', { style: { fontSize: 13, color: '#64748B', marginBottom: 12 } },
        `נמצאו ${allRows.length} שורות. מפה את העמודות:`
      ),

      // תצוגה מקדימה
      React.createElement('div', { style: { overflowX: 'auto', marginBottom: 16, borderRadius: 8, border: '1px solid #E2E8F0' } },
        React.createElement('table', { style: styles.table },
          React.createElement('thead', null,
            React.createElement('tr', null,
              headers.map((h, i) => React.createElement('th', { key: i, style: styles.th }, h || `עמודה ${i+1}`))
            )
          ),
          React.createElement('tbody', null,
            allRows.slice(0, 3).map((row, i) =>
              React.createElement('tr', { key: i },
                headers.map((_, j) => React.createElement('td', { key: j, style: styles.td }, row[j] || '—'))
              )
            )
          )
        )
      ),

      // מיפוי
      React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 } },
        ColSelect('תאריך עסקה', mapping.date_col, v => setMap('date_col', v), headers, true),
        ColSelect('בית עסק *', mapping.business_col, v => setMap('business_col', v), headers, true),
        ColSelect('תאריך ערך', mapping.value_date_col, v => setMap('value_date_col', v), headers, false),
        ColSelect('פרטים נוספים', mapping.details_col, v => setMap('details_col', v), headers, false),
        needsAccountCol && ColSelect('שם חשבון *', mapping.account_col, v => setMap('account_col', v), headers, true),
      ),

      // סכום
      React.createElement('div', { style: { marginBottom: 16 } },
        React.createElement('label', { style: styles.label }, 'מבנה הסכום'),
        React.createElement('div', { style: { display: 'flex', gap: 8, marginBottom: 8 } },
          React.createElement('button', {
            style: { ...styles.typeBtn, ...(mapping.amount_mode === 'single' ? styles.typeBtnActive : {}) },
            onClick: () => setMap('amount_mode', 'single'),
          }, 'עמודה אחת'),
          React.createElement('button', {
            style: { ...styles.typeBtn, ...(mapping.amount_mode === 'double' ? styles.typeBtnActive : {}) },
            onClick: () => setMap('amount_mode', 'double'),
          }, 'חובה / זכות'),
        ),
        mapping.amount_mode === 'single'
          ? React.createElement('div', null,
              React.createElement('select', {
                style: { ...styles.select, marginBottom: 8 },
                value: mapping.amount_col,
                onChange: e => setMap('amount_col', e.target.value),
              },
                React.createElement('option', { value: '' }, 'בחר עמודת סכום...'),
                headers.map((h, i) => React.createElement('option', { key: i, value: i }, h || `עמודה ${i+1}`))
              ),
              React.createElement('div', { style: { display: 'flex', gap: 8 } },
                React.createElement('button', {
                  style: { ...styles.typeBtn, ...(mapping.amount_type === 'minus_expense' ? styles.typeBtnActive : {}) },
                  onClick: () => setMap('amount_type', 'minus_expense'),
                }, 'מינוס = הוצאה'),
                React.createElement('button', {
                  style: { ...styles.typeBtn, ...(mapping.amount_type === 'plus_expense' ? styles.typeBtnActive : {}) },
                  onClick: () => setMap('amount_type', 'plus_expense'),
                }, 'פלוס = הוצאה'),
              )
            )
          : React.createElement('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
              React.createElement('div', null,
                React.createElement('label', { style: styles.label }, 'עמודת חובה'),
                React.createElement('select', { style: styles.select, value: mapping.debit_col, onChange: e => setMap('debit_col', e.target.value) },
                  React.createElement('option', { value: '' }, 'בחר...'),
                  headers.map((h, i) => React.createElement('option', { key: i, value: i }, h || `עמודה ${i+1}`))
                )
              ),
              React.createElement('div', null,
                React.createElement('label', { style: styles.label }, 'עמודת זכות'),
                React.createElement('select', { style: styles.select, value: mapping.credit_col, onChange: e => setMap('credit_col', e.target.value) },
                  React.createElement('option', { value: '' }, 'בחר...'),
                  headers.map((h, i) => React.createElement('option', { key: i, value: i }, h || `עמודה ${i+1}`))
                )
              )
            )
      ),

      React.createElement('div', { style: { display: 'flex', gap: 8 } },
        React.createElement('button', { style: styles.btnSecondary, onClick: () => setStep(0) }, 'חזור'),
        React.createElement('button', {
          style: { ...styles.btnPrimary, opacity: (needsAccountCol && !mapping.account_col) ? 0.5 : 1 },
          onClick: handleBuildReview,
          disabled: needsAccountCol && !mapping.account_col,
        }, 'המשך לסקירה →'),
      )
    ),

    // ── שלב 3 ──
    step === 2 && React.createElement('div', { style: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', overflow: 'hidden' } },

      React.createElement('div', { style: { padding: '14px 20px', borderBottom: '1px solid #E2E8F0', backgroundColor: '#F8FAFC' } },
        React.createElement('div', { style: { display: 'flex', gap: 20, alignItems: 'center', flexWrap: 'wrap', marginBottom: fallbackCount > 0 ? 8 : 0 } },
          React.createElement('span', { style: { fontSize: 13, color: '#10B981', fontWeight: '500' } }, `✓ ${newCount} חדשות`),
          React.createElement('span', { style: { fontSize: 13, color: '#F59E0B', fontWeight: '500' } }, `⚠ ${dupCount} כפולות`),
          React.createElement('span', { style: { fontSize: 13, color: '#2563EB', fontWeight: '500' } }, `🤖 ${autoCount} סווגו`),
          React.createElement('div', { style: { marginRight: 'auto', display: 'flex', gap: 8 } },
            React.createElement('button', { style: styles.btnSecondary, onClick: () => setStep(1) }, 'חזור'),
            React.createElement('button', {
              style: { ...styles.btnPrimary, backgroundColor: '#10B981' },
              onClick: () => {
                if (reviewRows.every(r => !r.accountId)) {
                  alert('⚠️ לא נבחר חשבון — לא ניתן ליבא')
                  return
                }
                handleImport(false)
              },
            }, `יבא ${newCount} ללא כפולות`),
            React.createElement('button', {
              style: styles.btnPrimary,
              onClick: () => {
                if (reviewRows.every(r => !r.accountId)) {
                  alert('⚠️ לא נבחר חשבון — לא ניתן ליבא')
                  return
                }
                handleImport(true)
              },
            }, `יבא הכל (${reviewRows.length})`),
          )
        ),
        fallbackCount > 0 && React.createElement('p', { style: { fontSize: 12, color: '#F59E0B', margin: 0 } },
          `📅 ${fallbackCount} שורות ללא תאריך יקבלו תאריך ברירת מחדל: ${fallbackMonth}-${String(getDefaultDay()).padStart(2, '0')}`
        ),
      ),

      React.createElement('div', { style: { overflowX: 'auto', maxHeight: '60vh', overflowY: 'auto' } },
        React.createElement('table', { style: { ...styles.table, width: '100%' } },
          React.createElement('thead', { style: { position: 'sticky', top: 0, zIndex: 1 } },
            React.createElement('tr', null,
              ['תאריך', 'בית עסק', 'סכום', 'חשבון', 'קטגוריה', 'סטטוס'].map(h =>
                React.createElement('th', { key: h, style: styles.th }, h)
              )
            )
          ),
          React.createElement('tbody', null,
            reviewRows.map((row, i) =>
              React.createElement('tr', {
                key: i,
                style: { backgroundColor: row.isDuplicate ? '#FFFBEB' : row.usedFallbackDate ? '#EFF6FF' : '#fff', borderBottom: '1px solid #F1F5F9' }
              },
                React.createElement('td', { style: styles.td },
                  row.usedFallbackDate
                    ? React.createElement('span', { style: { color: '#2563EB' } }, `${row.rawDate} *`)
                    : row.rawDate
                ),
                React.createElement('td', { style: { ...styles.td, fontWeight: '500' } }, row.rawBusiness || '—'),
                React.createElement('td', { style: { ...styles.td, color: row.txType === 'Income' ? '#10B981' : '#E11D48', fontWeight: '500' } },
                  `${row.txType === 'Income' ? '+' : '−'}₪${row.amount.toLocaleString('he-IL')}`
                ),
                React.createElement('td', { style: styles.td },
                  accounts.find(a => a.id == row.accountId)?.name || row.accountName || '—'
                ),
                React.createElement('td', { style: styles.td },
                  React.createElement('select', {
                    style: {
                      border: '1px solid #E2E8F0', borderRadius: 6, padding: '3px 6px', fontSize: 12,
                      backgroundColor: row.autoDetected ? '#EFF6FF' : '#fff',
                      color: row.autoDetected ? '#2563EB' : '#475569',
                    },
                    value: row.categoryId || '',
                    onChange: e => {
                      const newRows = [...reviewRows]
                      const cat = categories.find(c => c.id == e.target.value)
                      newRows[i] = { ...newRows[i], categoryId: e.target.value || null, categoryName: cat?.name, autoDetected: false }
                      setReviewRows(newRows)
                    }
                  },
                    React.createElement('option', { value: '' }, row.autoDetected ? `🤖 ${row.categoryName}` : 'בחר...'),
                    categories
                      .filter(c => row.txType === 'Income' ? c.type === 'Income' : c.type === 'Expense')
                      .map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.name} ${c.icon || ''}`))
                  )
                ),
                React.createElement('td', { style: styles.td },
                  row.isDuplicate
                    ? React.createElement('span', { style: { color: '#F59E0B', fontSize: 12 } }, '⚠ כפולה')
                    : React.createElement('span', { style: { color: '#10B981', fontSize: 12 } }, '✓ חדשה')
                ),
              )
            )
          )
        )
      )
    ),

    // ── שלב 4 ──
    step === 3 && step3Result && React.createElement('div', { style: { ...styles.card, textAlign: 'center', padding: 40 } },
      React.createElement('p', { style: { fontSize: 48, marginBottom: 12 } }, '✅'),
      React.createElement('h2', { style: { fontSize: 18, fontWeight: 'bold', marginBottom: 16 } }, 'היבוא הושלם!'),
      React.createElement('p', { style: { color: '#10B981', marginBottom: 4, fontSize: 14 } }, `✓ ${step3Result.imported} תנועות נוספו`),
      step3Result.skipped > 0 && React.createElement('p', { style: { color: '#94A3B8', fontSize: 13 } }, `⏭ ${step3Result.skipped} דולגו`),
      React.createElement('div', { style: { display: 'flex', gap: 8, justifyContent: 'center', marginTop: 20 } },
        React.createElement('button', {
          style: styles.btnSecondary,
          onClick: () => { setStep(0); setFileName(''); setPasteText(''); setReviewRows([]) },
        }, 'יבא קובץ נוסף'),
        React.createElement('button', {
          style: styles.btnPrimary,
          onClick: () => onNavigate && onNavigate('transactions'),
        }, 'עבור לתנועות'),
      )
    ),
  )
)
}

function ColSelect(label, value, onChange, headers, required) {
  return React.createElement('div', { key: label },
    React.createElement('label', { style: {
      display: 'block', fontSize: 12, fontWeight: '500',
      color: required ? '#0F172A' : '#64748B', marginBottom: 4
    } }, label),
    React.createElement('select', {
      style: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 10px', fontSize: 13, outline: 'none' },
      value: value,
      onChange: e => onChange(e.target.value),
    },
      React.createElement('option', { value: '' }, required ? 'בחר...' : 'לא נבחר'),
      headers.map((h, i) => React.createElement('option', { key: i, value: String(i) }, h || `עמודה ${i+1}`))
    )
  )
}

const styles = {
  page: { padding: 28, maxWidth: 900, margin: '0 auto' },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A', marginBottom: 20 },
  stepper: { display: 'flex', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 4 },
  stepCircle: { width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 'bold', flexShrink: 0 },
  stepLine: { width: 30, height: 2, backgroundColor: '#E2E8F0' },
  card: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: 24 },
  label: { display: 'block', fontSize: 12, fontWeight: '500', color: '#475569', marginBottom: 5 },
  select: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none' },
  textarea: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '10px 12px', fontSize: 13, outline: 'none', resize: 'vertical', fontFamily: 'monospace', direction: 'ltr' },
  dropZone: { border: '2px dashed #E2E8F0', borderRadius: 12, padding: 36, textAlign: 'center', cursor: 'pointer' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 12 },
  th: { textAlign: 'right', padding: '10px 12px', backgroundColor: '#F8FAFC', borderBottom: '1px solid #E2E8F0', fontWeight: '600', color: '#475569', whiteSpace: 'nowrap' },
  td: { padding: '8px 12px', color: '#334155', verticalAlign: 'middle' },
  tabBtn: { flex: 1, padding: '10px', border: 'none', backgroundColor: '#F8FAFC', fontSize: 13, cursor: 'pointer', color: '#475569' },
  tabBtnActive: { backgroundColor: '#2563EB', color: '#fff' },
  typeBtn: { flex: 1, padding: '7px 12px', borderRadius: 8, border: '1px solid #E2E8F0', backgroundColor: '#F8FAFC', fontSize: 12, cursor: 'pointer', color: '#475569' },
  typeBtnActive: { backgroundColor: '#2563EB', color: '#fff', border: '1px solid #2563EB' },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
  btnSecondary: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '9px 20px', fontSize: 13, cursor: 'pointer' },
}

module.exports = Import