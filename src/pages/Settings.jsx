const React = require('react')
const { useState, useEffect } = require('react')
const db = require('../db/index.js')
const os = require('os')
const path = require('path')

const SETTINGS_KEYS = {
  DEFAULT_DAY: 'default_transaction_day',
  DATE_MODE: 'date_calc_mode',
  EMERGENCY_MONTHS: 'emergency_months',
  MAASER_RATE: 'maaser_rate_setting',
}

function getSetting(key, fallback) {
  try {
    const row = db.prepare(
      "SELECT cleaned_name FROM Automation_Rules WHERE original_string=? AND match_type='setting'"
    ).get(key)
    return row ? row.cleaned_name : fallback
  } catch { return fallback }
}

function saveSetting(key, value) {
  try {
    const exists = db.prepare(
      "SELECT id FROM Automation_Rules WHERE original_string=? AND match_type='setting'"
    ).get(key)
    if (exists) {
      db.prepare("UPDATE Automation_Rules SET cleaned_name=? WHERE original_string=? AND match_type='setting'")
        .run(String(value), key)
    } else {
      db.prepare("INSERT INTO Automation_Rules (original_string, cleaned_name, match_type, priority, use_count) VALUES (?,?,'setting',0,0)")
        .run(key, String(value))
    }
  } catch {}
}

function Settings() {
  const [defaultDay, setDefaultDay] = useState(() => getSetting(SETTINGS_KEYS.DEFAULT_DAY, '25'))
  const [dateMode, setDateMode] = useState(() => getSetting(SETTINGS_KEYS.DATE_MODE, 'transaction_date'))
  const [emergencyMonths, setEmergencyMonths] = useState(() => getSetting(SETTINGS_KEYS.EMERGENCY_MONTHS, '3'))
  const [maaserRate, setMaaserRate] = useState(() => getSetting(SETTINGS_KEYS.MAASER_RATE, '0.1'))
  const [saved, setSaved] = useState(false)
  const [rules, setRules] = useState([])
  const [showRules, setShowRules] = useState(false)
  const [editRule, setEditRule] = useState(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [resetStep, setResetStep] = useState(0)
  const [deleteStep, setDeleteStep] = useState(0) // 0: כפתור | 1: בדיקה | 2: מחיקה
  const [deleteMessage, setDeleteMessage] = useState('')

  function loadRules() {
    const rows = db.prepare(`
      SELECT r.*, c.name as category_name, c.icon as category_icon
      FROM Automation_Rules r
      LEFT JOIN Categories c ON r.category_id=c.id
      WHERE r.match_type NOT IN ('setting', 'mapping')
      ORDER BY r.use_count DESC
    `).all()
    setRules(rows)
  }

  useEffect(() => { if (showRules) loadRules() }, [showRules])

  function handleSave() {
    saveSetting(SETTINGS_KEYS.DEFAULT_DAY, defaultDay)
    saveSetting(SETTINGS_KEYS.DATE_MODE, dateMode)
    saveSetting(SETTINGS_KEYS.EMERGENCY_MONTHS, emergencyMonths)
    saveSetting(SETTINGS_KEYS.MAASER_RATE, maaserRate)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const { ipcRenderer } = require('electron')

  async function handleExport() {
    try {
      const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'proton', 'proton.db')
      const result = await ipcRenderer.invoke('export-db', dbPath)
      if (result.cancelled) return
      if (result.success) {
        alert(`✓ הגיבוי נשמר בהצלחה:\n${result.path}`)
      } else {
        alert(`שגיאה: ${result.error}`)
      }
    } catch(e) {
      alert(`שגיאה: ${e.message}`)
    }
  }

  async function handleImport() {
    if (!confirm('ייבוא יחליף את כל הנתונים הנוכחיים! האם להמשיך?')) return
    try {
      const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'proton', 'proton.db')
      const result = await ipcRenderer.invoke('import-db', dbPath)
      if (result.cancelled) return
      if (result.success) {
        alert('✓ הנתונים יובאו בהצלחה. אנא הפעל מחדש את האפליקציה.')
      } else {
        alert(`שגיאה: ${result.error}`)
      }
    } catch(e) {
      alert(`שגיאה: ${e.message}`)
    }
  }

  function handleReset() {
    if (resetStep === 0) { setShowResetConfirm(true); setResetStep(1); return }
    if (resetStep === 1) { setResetStep(2); return }
    // שלב 3 — מחיקה בפועל
    db.exec(`
      PRAGMA foreign_keys = OFF;
      DELETE FROM Transactions;
      DELETE FROM Budget_Goals;
      DELETE FROM Liabilities;
      DELETE FROM Insurance_Policies;
      DELETE FROM Savings_Goals;
      DELETE FROM Recurring_Templates;
      DELETE FROM Assets;
      DELETE FROM Informal_Debts;
      DELETE FROM Accounts;
      DELETE FROM Automation_Rules WHERE match_type NOT IN ('setting','mapping');
      PRAGMA foreign_keys = ON;
    `)
    setShowResetConfirm(false)
    setResetStep(0)
    alert('✓ המערכת אופסה. כל הנתונים נמחקו.')
  }

  // ──── מחיקה בטוחה של נתונים ────
  async function handleDeleteData() {
    if (deleteStep === 0) {
      // שלב 1: בדוק אם המשתמש רוצה לגבות
      const shouldBackup = confirm(
        '⚠️ הסרת פרוטון\n\n' +
        'מומלץ מאוד לגבות את הנתונים לפני המחיקה!\n\n' +
        'לחץ OK כדי לגבות, או Cancel כדי להמשיך ללא גיבוי.'
      )
      
      if (shouldBackup) {
        // גבה את הנתונים
        try {
          const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'proton', 'proton.db')
          const result = await ipcRenderer.invoke('export-db', dbPath)
          if (!result.success && !result.cancelled) {
            alert('⚠️ שגיאה בגיבוי: ' + result.error)
            return
          }
          if (result.cancelled) {
            alert('⚠️ ביטלת את הגיבוי. להמשך מחיקה?')
          } else {
            alert('✓ גיבוי בוצע בהצלחה:\n' + result.path)
          }
        } catch (e) {
          alert('⚠️ שגיאה בגיבוי: ' + e.message)
          return
        }
      }

      // עבור לשלב 2: אישור סופי
      setDeleteStep(1)
      setDeleteMessage('🚨 אישור אחרון\n\nכל הנתונים יימחקו ופרוטון יסגר.\nפעולה זו לא ניתנת לביטול!')
      return
    }

    if (deleteStep === 1) {
      // שלב 2: אישור סופי
      const confirmed = confirm(deleteMessage)
      if (!confirmed) {
        setDeleteStep(0)
        setDeleteMessage('')
        return
      }

      // שלב 3: מחיקה בטוחה
      setDeleteStep(2)
      setDeleteMessage('🔄 מוחק נתונים...')

      try {
        const dbPath = path.join(os.homedir(), 'AppData', 'Roaming', 'proton', 'proton.db')
        
        // סגור את ה-Database
        db.close()
        
        // קרא ל-safe-delete-db handler
        const result = await ipcRenderer.invoke('safe-delete-db', dbPath)
        
        if (result.success) {
          setDeleteMessage('✓ הנתונים נמחקו בהצלחה!\n\nכעת תוכל להסיר את פרוטון:\n1. הפעל > appwiz.cpl\n2. חפש "Pruton" ו-Uninstall')
          alert('✓ הנתונים נמחקו בהצלחה!\n\nכעת תוכל להסיר את פרוטון דרך:\nהגדרות > אפליקציות > הסר אפליקציה')
          
          // סגור את האפליקציה
          setTimeout(() => {
            ipcRenderer.send('quit-app')
          }, 1000)
        } else {
          setDeleteMessage('❌ שגיאה בעת מחיקה: ' + result.error)
          setDeleteStep(0)
        }
      } catch (e) {
        setDeleteMessage('❌ שגיאה: ' + e.message)
        setDeleteStep(0)
        alert('שגיאה: ' + e.message)
      }
    }
  }

  const fmt = n => '₪' + Math.abs(n).toLocaleString('he-IL', { maximumFractionDigits: 0 })

  return React.createElement('div', { style: styles.page },
    React.createElement('h1', { style: styles.title }, 'הגדרות'),


    // ── הגדרות תאריכים ──
    React.createElement('div', { style: styles.section },
      React.createElement('h2', { style: styles.sectionTitle }, 'תאריכים'),

      React.createElement('div', { style: styles.settingRow },
        React.createElement('div', null,
          React.createElement('p', { style: styles.settingLabel }, 'יום ברירת מחדל לחודשים קודמים'),
          React.createElement('p', { style: styles.settingDesc }, 'כשמוסיפים תנועה על חודש שעבר'),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('input', {
            type: 'number', min: 1, max: 28,
            style: styles.numInput,
            value: defaultDay,
            onChange: e => setDefaultDay(e.target.value),
          }),
          React.createElement('span', { style: { fontSize: 13, color: '#475569' } }, 'לחודש'),
        ),
      ),

      React.createElement('div', { style: { ...styles.settingRow, marginTop: 16, paddingTop: 16, borderTop: '1px solid #F1F5F9' } },
        React.createElement('div', null,
          React.createElement('p', { style: styles.settingLabel }, 'בסיס חישוב תאריך'),
          React.createElement('p', { style: styles.settingDesc }, 'על איזה תאריך יתבססו חישובי תקציב ודשבורד'),
        ),
        React.createElement('select', {
          style: styles.select,
          value: dateMode,
          onChange: e => setDateMode(e.target.value),
        },
          React.createElement('option', { value: 'transaction_date' }, 'תאריך עסקה'),
          React.createElement('option', { value: 'value_date' }, 'תאריך ערך'),
        ),
      ),
    ),

    // ── הגדרות מעשרות ──
    React.createElement('div', { style: styles.section },
      React.createElement('h2', { style: styles.sectionTitle }, 'מעשרות'),

      React.createElement('div', { style: styles.settingRow },
        React.createElement('div', null,
          React.createElement('p', { style: styles.settingLabel }, 'שיעור מעשר ברירת מחדל'),
        ),
        React.createElement('div', { style: { display: 'flex', border: '1px solid #E2E8F0', borderRadius: 10, overflow: 'hidden' } },
          React.createElement('button', {
            style: { padding: '7px 16px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: maaserRate === '0.1' ? '#2563EB' : '#F8FAFC', color: maaserRate === '0.1' ? '#fff' : '#475569' },
            onClick: () => setMaaserRate('0.1'),
          }, '10% מעשר'),
          React.createElement('button', {
            style: { padding: '7px 16px', border: 'none', fontSize: 13, cursor: 'pointer', backgroundColor: maaserRate === '0.2' ? '#2563EB' : '#F8FAFC', color: maaserRate === '0.2' ? '#fff' : '#475569' },
            onClick: () => setMaaserRate('0.2'),
          }, '20% חומש'),
        ),
      ),
    ),

    // ── קרן חירום ──
    React.createElement('div', { style: styles.section },
      React.createElement('h2', { style: styles.sectionTitle }, 'קרן חירום'),

      React.createElement('div', { style: styles.settingRow },
        React.createElement('div', null,
          React.createElement('p', { style: styles.settingLabel }, 'חודשי מחיה ביעד'),
          React.createElement('p', { style: styles.settingDesc }, 'כמה חודשי הוצאות לשמור בקרן החירום'),
        ),
        React.createElement('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
          React.createElement('input', {
            type: 'number', min: 1, max: 12,
            style: styles.numInput,
            value: emergencyMonths,
            onChange: e => setEmergencyMonths(e.target.value),
          }),
          React.createElement('span', { style: { fontSize: 13, color: '#475569' } }, 'חודשים'),
        ),
      ),
    ),

    // כפתור שמירה
    React.createElement('button', {
      style: { ...styles.btnPrimary, marginBottom: 16 },
      onClick: handleSave,
    }, saved ? '✓ נשמר!' : 'שמור הגדרות'),

    // ── ניהול חוקי זיהוי ──
    React.createElement('div', { style: styles.section },
      React.createElement('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: showRules ? 16 : 0 } },
        React.createElement('div', null,
          React.createElement('h2', { style: { ...styles.sectionTitle, marginBottom: 2 } }, 'חוקי זיהוי אוטומטי'),
          React.createElement('p', { style: styles.settingDesc }, 'חוקים שנלמדו מסיווג ידני'),
        ),
        React.createElement('button', {
          style: styles.btnSecondary,
          onClick: () => setShowRules(s => !s),
        }, showRules ? 'סגור' : `נהל (${rules.length || '?'})`),
      ),

      showRules && React.createElement('div', null,
        rules.length === 0
          ? React.createElement('p', { style: { color: '#94A3B8', fontSize: 13 } }, 'אין חוקים עדיין')
          : React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
              rules.map(rule =>
                React.createElement('div', { key: rule.id, style: styles.ruleRow },
                  React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                    React.createElement('p', { style: { fontSize: 13, fontWeight: '500', color: '#0F172A', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, rule.original_string),
                    React.createElement('p', { style: { fontSize: 11, color: '#64748B' } }, (() => {
                      const cat = rule.category_id
                        ? db.prepare('SELECT c.*, cp.name as parent_name FROM Categories c LEFT JOIN Categories cp ON c.parent_id=cp.id WHERE c.id=?').get(rule.category_id)
                        : null
                      const catDisplay = cat?.parent_id
                        ? `${cat.parent_name} ← ${cat.name}`
                        : (cat?.name || 'ללא קטגוריה')
                      return `→ ${rule.category_icon || ''} ${catDisplay} | שימושים: ${rule.use_count}`
                    })()),
                  ),
                  React.createElement('div', { style: { display: 'flex', gap: 6 } },
                    React.createElement('button', {
                      style: { ...styles.iconBtn },
                      onClick: () => setEditRule(rule),
                    }, '✏️'),
                    React.createElement('button', {
                      style: { ...styles.iconBtn, color: '#E11D48' },
                      onClick: () => { db.prepare('DELETE FROM Automation_Rules WHERE id=?').run(rule.id); loadRules() },
                    }, '🗑'),
                  ),
                )
              )
            )
      ),
    ),

    // ── גיבוי ושחזור ──
    React.createElement('div', { style: styles.section },
      React.createElement('h2', { style: styles.sectionTitle }, 'גיבוי ושחזור'),
      React.createElement('div', { style: { display: 'flex', gap: 10 } },
        React.createElement('button', {
          style: { ...styles.btnPrimary, backgroundColor: '#10B981' },
          onClick: handleExport,
        }, '📦 ייצא גיבוי'),
        React.createElement('button', {
          style: styles.btnSecondary,
          onClick: handleImport,
        }, '📂 ייבא גיבוי'),
      ),
      React.createElement('p', { style: { fontSize: 11, color: '#94A3B8', marginTop: 8 } },
        'הגיבוי נשמר כקובץ .db על שולחן העבודה'
      ),
    ),

    // ── איפוס מערכת ──
    React.createElement('div', { style: { ...styles.section, borderColor: '#FCA5A5' } },
      React.createElement('h2', { style: { ...styles.sectionTitle, color: '#E11D48' } }, '⚠️ איפוס מערכת'),
      React.createElement('p', { style: { fontSize: 13, color: '#475569', marginBottom: 12 } },
        'מחיקת כל התנועות, החשבונות וכל הנתונים. פעולה בלתי הפיכה!'
      ),

      !showResetConfirm
        ? React.createElement('button', {
            style: { ...styles.btnPrimary, backgroundColor: '#E11D48' },
            onClick: () => setShowResetConfirm(true),
          }, 'איפוס מערכת')
        : React.createElement('div', { style: { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 16 } },
            React.createElement('p', { style: { fontSize: 14, fontWeight: '600', color: '#E11D48', marginBottom: 12 } },
              resetStep === 1
                ? '⚠️ האם אתה בטוח? כל הנתונים יימחקו לצמיתות!'
                : '🚨 אישור אחרון — פעולה זו לא ניתנת לביטול!'
            ),
            React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('button', {
                style: styles.btnSecondary,
                onClick: () => { setShowResetConfirm(false); setResetStep(0) },
              }, 'ביטול'),
              React.createElement('button', {
                style: { ...styles.btnPrimary, backgroundColor: '#E11D48' },
                onClick: handleReset,
              }, resetStep === 1 ? 'כן, אני בטוח' : 'מחק הכל לצמיתות'),
            ),
          ),
    ),

    // ── הסרת פרוטון (בטוחה) ──
    React.createElement('div', { style: { ...styles.section, borderColor: '#FCA5A5', marginTop: 16 } },
      React.createElement('h2', { style: { ...styles.sectionTitle, color: '#E11D48' } }, '🗑 הסרת פרוטון'),
      React.createElement('p', { style: { fontSize: 13, color: '#475569', marginBottom: 12 } },
        'מחיקה בטוחה של הנתונים, עם אפשרות לגיבוי.'
      ),

      deleteStep === 0
        ? React.createElement('button', {
            style: { ...styles.btnPrimary, backgroundColor: '#E11D48' },
            onClick: handleDeleteData,
          }, '🗑 הסר את פרוטון')
        : React.createElement('div', { style: { backgroundColor: '#FEF2F2', borderRadius: 10, padding: 16 } },
            React.createElement('p', { style: { fontSize: 13, color: '#E11D48', marginBottom: 12, fontWeight: '500', whiteSpace: 'pre-wrap', lineHeight: '1.5' } }, deleteMessage),
            deleteStep === 1 && React.createElement('div', { style: { display: 'flex', gap: 8 } },
              React.createElement('button', {
                style: styles.btnSecondary,
                onClick: () => { setDeleteStep(0); setDeleteMessage('') },
              }, 'ביטול'),
              React.createElement('button', {
                style: { ...styles.btnPrimary, backgroundColor: '#E11D48' },
                onClick: handleDeleteData,
              }, 'אישור'),
            ),
            deleteStep === 2 && React.createElement('div', { style: { textAlign: 'center' } },
              React.createElement('p', { style: { fontSize: 12, color: '#94A3B8', marginTop: 8 } }, 'מחכה...')
            ),
          ),
    ),

    React.createElement(About),

    // מודאל עריכת חוק
    editRule && React.createElement(EditRuleModal, {
      rule: editRule,
      onClose: () => setEditRule(null),
      onSave: () => { setEditRule(null); loadRules() },
    }),
  )
}

// ─── מודאל עריכת חוק ───────────────────────────────────────────────────

function EditRuleModal({ rule, onClose, onSave }) {
  const categories = db.prepare('SELECT * FROM Categories WHERE is_active=1 ORDER BY sort_order').all()
  const [categoryId, setCategoryId] = useState(rule.category_id?.toString() ?? '')
  const [cleanedName, setCleanedName] = useState(rule.cleaned_name || rule.original_string)

  function handleSave() {
    db.prepare('UPDATE Automation_Rules SET category_id=?, cleaned_name=? WHERE id=?')
      .run(categoryId || null, cleanedName, rule.id)
    onSave()
  }

  return React.createElement('div', { style: styles.overlay },
    React.createElement('div', { style: { ...styles.modal, maxWidth: 420 } },
      React.createElement('div', { style: styles.modalHeader },
        React.createElement('h2', { style: styles.modalTitle }, 'עריכת חוק זיהוי'),
        React.createElement('button', { style: styles.closeBtn, onClick: onClose }, '✕'),
      ),
      React.createElement('div', { style: styles.modalBody },
        React.createElement('p', { style: { fontSize: 12, color: '#64748B', marginBottom: 16, backgroundColor: '#F8FAFC', padding: 10, borderRadius: 8 } },
          `שם מקורי: ${rule.original_string}`
        ),
        Field('שם נקי (כפי שיוצג)', React.createElement('input', { style: styles.input, value: cleanedName, onChange: e => setCleanedName(e.target.value) })),
        Field('קטגוריה', React.createElement('select', { style: styles.input, value: categoryId, onChange: e => setCategoryId(e.target.value) },
          React.createElement('option', { value: '' }, '— ללא קטגוריה —'),
          categories.map(c => React.createElement('option', { key: c.id, value: c.id }, `${c.name} ${c.icon || ''}`))
        )),
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
  page: { padding: 32 },
  title: { fontSize: 22, fontWeight: 'bold', color: '#0F172A', marginBottom: 24 },
  section: { backgroundColor: '#fff', borderRadius: 16, border: '1px solid #E2E8F0', padding: 24, marginBottom: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#0F172A', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E2E8F0' },
  settingRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 },
  settingLabel: { fontSize: 14, fontWeight: '500', color: '#0F172A', marginBottom: 4 },
  settingDesc: { fontSize: 12, color: '#94A3B8' },
  numInput: { width: 64, border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 12px', fontSize: 14, textAlign: 'center', outline: 'none' },
  select: { border: '1px solid #E2E8F0', borderRadius: 10, padding: '7px 12px', fontSize: 13, outline: 'none' },
  btnPrimary: { backgroundColor: '#2563EB', color: '#fff', border: 'none', borderRadius: 10, padding: '9px 20px', fontSize: 13, fontWeight: '500', cursor: 'pointer' },
  btnSecondary: { backgroundColor: '#F1F5F9', color: '#475569', border: '1px solid #E2E8F0', borderRadius: 10, padding: '9px 20px', fontSize: 13, cursor: 'pointer' },
  ruleRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', backgroundColor: '#F8FAFC', borderRadius: 8, border: '1px solid #E2E8F0' },
  iconBtn: { background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, padding: '3px 6px' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: 20, width: '100%', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' },
  modalHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #E2E8F0' },
  modalTitle: { fontSize: 16, fontWeight: 'bold', color: '#0F172A' },
  closeBtn: { background: 'none', border: 'none', fontSize: 18, color: '#94A3B8', cursor: 'pointer' },
  modalBody: { padding: 24 },
  modalFooter: { display: 'flex', gap: 8, padding: '16px 24px', borderTop: '1px solid #E2E8F0' },
  input: { width: '100%', border: '1px solid #E2E8F0', borderRadius: 10, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' },
}

function About() {
  function openLink(url) {
    require('electron').shell.openExternal(url)
  }

  return React.createElement('div', { style: { ...styles.section, textAlign: 'center' } },
    // לוגו וכותרת
    React.createElement('div', { style: { marginBottom: 16 } },
    React.createElement('svg', { 
      width: 64, height: 64, viewBox: '0 0 512 512', 
      xmlns: 'http://www.w3.org/2000/svg',
      style: { marginBottom: 8 }
    },
      React.createElement('rect', { x: 0, y: 0, width: 512, height: 512, rx: 114, fill: '#1E3A8A' }),
      React.createElement('line', { x1: 186, y1: 126, x2: 186, y2: 386, stroke: '#93C5FD', strokeWidth: 28, strokeLinecap: 'round' }),
      React.createElement('path', { d: 'M186 126 Q346 126 346 226 Q346 326 186 326', fill: 'none', stroke: '#93C5FD', strokeWidth: 28, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      React.createElement('circle', { cx: 266, cy: 226, r: 48, fill: '#F59E0B', opacity: 0.9 }),
      React.createElement('text', { x: 266, y: 242, textAnchor: 'middle', fontSize: 36, fontWeight: 700, fill: '#1E3A8A', fontFamily: 'serif' }, '₪'),
    ),
      React.createElement('p', { style: { fontSize: 20, fontWeight: 'bold', color: '#0F172A' } }, 'פרוטון'),
      React.createElement('p', { style: { fontSize: 13, color: '#64748B', marginBottom: 4 } }, 'v0.2.4 Beta'),
      React.createElement('p', { style: { fontSize: 13, color: '#475569' } }, 'מערכת ניהול פיננסי אישי'),
    ),

    // קו מפריד
    React.createElement('div', { style: { height: 1, backgroundColor: '#E2E8F0', margin: '16px 0' } }),

    // קישורי שותפים
    React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 12 } }, 'פתח תיק השקעות'),
    React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16 } },
      React.createElement('button', {
        style: { ...styles.btnPrimary, backgroundColor: '#1E3A8A' },
        onClick: () => openLink('https://landing.meitav.co.il/he-IL/landing/trade/tradeleadsfreinds?utm_medium=7DC21A197FECEFB70B2AE5E475A05030'),
      }, '📈 מיטב טרייד'),
      React.createElement('button', {
        style: { ...styles.btnPrimary, backgroundColor: '#0F766E' },
        onClick: () => openLink('https://xnestrade.xnes.co.il/page/101?customerCode=72f8dafe'),
      }, '📊 אקסלנס טרייד'),
    ),
    React.createElement('p', { style: { fontSize: 10, color: '#94A3B8', marginTop: 4 } }, 
      '* קישורי שותפים — הפניה דרך הלינקים תומכת בפיתוח פרוטון ללא עלות נוספת עבורך'
    ),

    // קו מפריד
    React.createElement('div', { style: { height: 1, backgroundColor: '#E2E8F0', margin: '16px 0' } }),

    // תמיכה בפרויקט
    React.createElement('p', { style: { fontSize: 13, fontWeight: '600', color: '#475569', marginBottom: 12 } }, 'אהבת את פרוטון?'),
    React.createElement('div', { style: { display: 'flex', gap: 10, justifyContent: 'center', marginBottom: 16 } },
      React.createElement('button', {
        style: { ...styles.btnPrimary, backgroundColor: '#FBBF24', color: '#0F172A' },
        onClick: () => openLink('LINK_COFFEE'),
      }, '☕ פרגנו לי בקפה'),
      React.createElement('button', {
        style: styles.btnSecondary,
        onClick: () => openLink('https://github.com/excelnik/proton'),
      },
        React.createElement('span', { 
          style: { display: 'flex', alignItems: 'center', gap: 6 } 
        },
          React.createElement('svg', { 
            width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor'
          },
            React.createElement('path', { 
              d: 'M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 . 405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.016 12.016 0 0 0 24 12c0-6.63-5.37-12-12-12z'
            })
          ),
          'GitHub'
        )
      ),
    ),

    // רישיון וקרדיט
    React.createElement('div', { style: { height: 1, backgroundColor: '#E2E8F0', margin: '16px 0' } }),
    React.createElement('p', { style: { fontSize: 11, color: '#94A3B8' } }, '© 2026 Pruton — GPL v3 License'),
  )
}

module.exports = Settings
